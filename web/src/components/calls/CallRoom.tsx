import { useCallback, useEffect, useRef, useState } from "react";
import { Button, LiveAnnouncer, useAnnouncer } from "@/components/platform/ui";
import type { Meeting } from "@/lib/platform/contracts";
import { roomApi } from "@/lib/meetings/room-api";
import { loadRoomClient, type MediaChoice, type RoomClient } from "@/lib/meetings/room-client";
import {
  endedText, fullText, gateScreen, NOUN, overAnnouncement, removedText, startedAnnouncement, WAITING_POLL_MS,
  type CallRoomProps, type OverScreen,
} from "@/lib/meetings/room-model";
import EndScreen from "./EndScreen";
import PreJoin from "./PreJoin";
import Room from "./Room";

/**
 * The call room island (`/dashboard/calls/:id`; lib/meetings/README.md, "The room"): the pre-join
 * page, the call, and the pages after it, in one island so the call keeps its media while it moves
 * between them. It talks to the provider only through a RoomClient (loaded on Join, so no SDK is in
 * this chunk) and to TTV through the meeting routes. Every change is said through its LiveAnnouncer.
 */

type Phase =
  | { kind: "gate" }
  | { kind: "joining" }
  | { kind: "room"; client: RoomClient; audioOnly: boolean; opened: boolean }
  /** After a call, or instead of one: the page, and what was said as it appeared. */
  | { kind: "over"; screen: OverScreen; said: string };

const CONNECT_FAILED = { title: "The call couldn't connect", body: "Check your connection and try again. Your place was given back." };
const SERVICE_DOWN = { title: "The call didn't start", body: "The call service didn't answer. Try again in a moment." };

export default function CallRoom(props: CallRoomProps) {
  return (
    <LiveAnnouncer name="call">
      <CallRoomBody {...props} />
    </LiveAnnouncer>
  );
}

function CallRoomBody(props: CallRoomProps) {
  const voice = useAnnouncer();
  const [meeting, setMeeting] = useState<Meeting>(props.meeting);
  const [clockOffset, setClockOffset] = useState(0);
  const [clock, setClock] = useState(props.renderedAt);
  const [phase, setPhase] = useState<Phase>({ kind: "gate" });
  const [failure, setFailure] = useState<{ title: string; body: string } | null>(null);
  const [conductNeeded, setConductNeeded] = useState(false);
  const noun = NOUN[meeting.purpose];
  const gate = gateScreen(meeting, clock, props.unavailable);

  // An end screen reached from the room or a failed join is said at once (one shown on arrival is not).
  // What a call is called doesn't change while the page is open.
  const { title, purpose, limitMinutes, recordingPolicy } = meeting;
  const over = useCallback((screen: OverScreen) => {
    const said = overAnnouncement(screen, { title, purpose, limitMinutes, recordingPolicy });
    setPhase((current) => (current.kind === "over" ? current : { kind: "over", screen, said }));
  }, [title, purpose, limitMinutes, recordingPolicy]);
  const onMeeting = useCallback((next: Meeting, offset: number) => {
    setMeeting(next);
    setClockOffset(offset);
  }, []);

  const shown = phase.kind === "over" ? phase : null;
  useEffect(() => {
    if (shown) voice?.say(shown.said, { priority: shown.screen.kind === "left" ? "polite" : "assertive" });
  }, [shown, voice]);

  // The room's client is released however the room goes: leaving, ending, being removed, the page going.
  const client = phase.kind === "room" ? phase.client : null;
  useEffect(() => () => void client?.leave(), [client]);

  // Waiting for a host: ask every WAITING_POLL_MS, and say when the call opens.
  const waiting = phase.kind === "gate" && gate.kind === "waiting";
  useEffect(() => {
    if (!waiting) return;
    const abort = new AbortController();
    async function ask() {
      const answer = await roomApi.get(meeting.id, abort.signal);
      if (!answer.ok) return;
      setMeeting(answer.value);
      if (answer.value.state === "LIVE" && answer.value.you.canJoin) voice?.say(startedAnnouncement(answer.value.purpose));
    }
    const timer = setInterval(() => void ask().catch(() => {}), WAITING_POLL_MS);
    return () => {
      abort.abort();
      clearInterval(timer);
    };
  }, [waiting, meeting.id, voice]);

  // A host early: Start comes on when the room may open.
  const opensAt = phase.kind === "gate" && gate.kind === "too-early" ? gate.opensAt : null;
  useEffect(() => {
    if (opensAt === null) return;
    const timer = setTimeout(() => setClock(Date.now()), Math.max(0, opensAt - Date.now()) + 50);
    return () => clearTimeout(timer);
  }, [opensAt]);

  // A join under way when the page goes (closed, navigated away, the island unmounted): whatever it
  // opened is released and its seat given back, now and again if the server's answer arrives later.
  const pending = useRef<{ client: RoomClient | null } | null>(null);
  const meetingId = meeting.id;
  useEffect(() => {
    const abandon = () => {
      const joining = pending.current;
      if (!joining) return;
      pending.current = null;
      void joining.client?.leave();
      void roomApi.leaveOnExit(meetingId).catch(() => {});
    };
    window.addEventListener("pagehide", abandon);
    return () => {
      window.removeEventListener("pagehide", abandon);
      abandon();
    };
  }, [meetingId]);

  async function join(choice: MediaChoice) {
    const joining: { client: RoomClient | null } = { client: null };
    pending.current = joining;
    const abandoned = () => pending.current !== joining;
    setPhase({ kind: "joining" });
    setFailure(null);
    const answer = await roomApi.join(meeting.id);
    if (abandoned()) {
      // The page went while the server was answering: give back the seat it may just have given.
      if (answer.ok) void roomApi.leaveOnExit(meeting.id).catch(() => {});
      return;
    }
    if (!answer.ok) {
      pending.current = null;
      return refused(answer.kind);
    }
    setConductNeeded(false);
    try {
      joining.client = await loadRoomClient(answer.value.provider, { meetingId: meeting.id });
      await joining.client.join({ token: answer.value.token, self: { userId: props.self.userId, name: props.self.name }, media: choice });
    } catch {
      if (abandoned()) return;
      pending.current = null;
      // A failed start releases every track it opened, and gives the seat back.
      await joining.client?.leave();
      await roomApi.leave(meeting.id);
      setFailure(CONNECT_FAILED);
      voice?.say(`${CONNECT_FAILED.title}. ${CONNECT_FAILED.body}`, { priority: "assertive" });
      return setPhase({ kind: "gate" });
    }
    if (abandoned()) {
      await joining.client.leave();
      void roomApi.leaveOnExit(meeting.id).catch(() => {});
      return;
    }
    pending.current = null;
    setMeeting(answer.value.meeting);
    setClockOffset(answer.value.meeting.now - Date.now());
    setPhase({ kind: "room", client: joining.client, audioOnly: choice.audioOnly, opened: meeting.state === "SCHEDULED" });
  }

  async function refused(kind: "missing" | "conflict" | "conduct" | "unavailable") {
    if (kind === "conduct") {
      setConductNeeded(true);
      voice?.say("Agree to how we talk to each other before you join.", { priority: "assertive" });
      return setPhase({ kind: "gate" });
    }
    if (kind === "unavailable") {
      setFailure(SERVICE_DOWN);
      voice?.say(`${SERVICE_DOWN.title}. ${SERVICE_DOWN.body}`, { priority: "assertive" });
      return setPhase({ kind: "gate" });
    }
    // Refused for the call's state, or the same 404: find out which screen is true now.
    const now = await roomApi.get(meeting.id);
    if (!now.ok) return over(now.kind === "missing" ? { kind: "removed" } : { kind: "ended", reason: null, cancelled: false });
    const latest = now.value;
    setMeeting(latest);
    if (latest.you.seat === "REMOVED") return over({ kind: "removed" });
    if (latest.state === "ENDED" || latest.state === "CANCELLED") {
      return over({ kind: "ended", reason: latest.endReason, cancelled: latest.state === "CANCELLED" });
    }
    if (kind === "conflict" && latest.state === "LIVE" && latest.you.canJoin) return over({ kind: "full" });
    setPhase({ kind: "gate" });
  }

  function again() {
    setFailure(null);
    setPhase({ kind: "gate" });
    void (async () => {
      const answer = await roomApi.get(meeting.id);
      if (answer.ok) setMeeting(answer.value);
    })();
  }

  const recorded = meeting.recordingPolicy === "ALWAYS" || meeting.recordingPolicy === "HOST";
  const screen: OverScreen | null = phase.kind === "over" ? phase.screen
    : gate.kind === "ended" ? { kind: "ended", reason: gate.reason, cancelled: gate.cancelled }
    : gate.kind === "removed" ? { kind: "removed" }
    : null;

  if (phase.kind === "room") {
    return (
      <Room
        room={props} meeting={meeting} client={phase.client} clockOffset={clockOffset} audioOnly={phase.audioOnly} opened={phase.opened}
        onMeeting={onMeeting} onOver={over}
      />
    );
  }

  if (screen) {
    switch (screen.kind) {
      case "ended": {
        const text = endedText(meeting, screen.reason, screen.cancelled, props.recordingRefused);
        return <EndScreen title={text.title} back={props.back}>{text.body}</EndScreen>;
      }
      case "removed": {
        const text = removedText(meeting.purpose);
        return <EndScreen title={text.title} back={props.back}>{text.body}</EndScreen>;
      }
      case "full": {
        const text = fullText(meeting.purpose, recorded && !props.recordingRefused);
        return <EndScreen title={text.title} back={props.back} action={<Button variant="primary" onClick={again}>Try again</Button>}>{text.body}</EndScreen>;
      }
      case "left":
        return (
          <EndScreen title={`You left ${meeting.title}`} back={props.back} action={<Button variant="primary" onClick={again}>Join again</Button>}>
            {`The ${noun} goes on without you. You can join again while it's open.`}
          </EndScreen>
        );
      case "replaced":
        return (
          <EndScreen title={`You joined ${meeting.title} somewhere else`} back={props.back} action={<Button variant="primary" onClick={again}>Use this tab instead</Button>}>
            You can be in a call from one place at a time, so this tab left it.
          </EndScreen>
        );
    }
  }

  return (
    <PreJoin
      room={{ ...props, meeting }}
      screen={gate.kind === "ended" || gate.kind === "removed" ? { kind: "closed" } : gate}
      joining={phase.kind === "joining"} failure={failure} conductNeeded={conductNeeded}
      onJoin={(choice) => void join(choice)}
    />
  );
}
