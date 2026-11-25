import { useCallback, useEffect, useRef, useState } from "react";
import { groupSentence, type LiveAnnouncerVoice } from "@/components/platform/ui";
import type { Meeting } from "@/lib/platform/contracts";
import { roomApi } from "@/lib/meetings/room-api";
import type { RoomClient, RoomNotice, RoomState } from "@/lib/meetings/room-client";
import { endsWithoutHost, noHostText, recordingAnnouncement, ROOM_POLL_MS, type OverScreen } from "@/lib/meetings/room-model";

/**
 * The call room's behaviour, apart from its drawing (Room.tsx): what the provider says, what the
 * server says, and what is said aloud about each (UX-REVIEW §5).
 */

/** The client's state, kept current. */
export function useRoomState(client: RoomClient): RoomState {
  const [state, setState] = useState(() => client.getState());
  useEffect(() => {
    setState(client.getState());
    return client.subscribe(setState);
  }, [client]);
  return state;
}

/** A value from the previous render (`initial` on the first), so a change is said once. */
function usePrevious<T>(value: T, initial: T = value): T {
  const ref = useRef(initial);
  useEffect(() => { ref.current = value; });
  return ref.current;
}

const ended = (meeting: Pick<Meeting, "state" | "endReason">): OverScreen =>
  ({ kind: "ended", reason: meeting.endReason, cancelled: meeting.state === "CANCELLED" });

/** What happens to this tab's person: muted or stopped by a host (said at once), removed, ended, replaced. */
export function useRoomNotices(client: RoomClient, voice: LiveAnnouncerVoice | null, meetingId: string, onOver: (screen: OverScreen) => void) {
  useEffect(() => client.onNotice((notice: RoomNotice) => {
    switch (notice) {
      case "muted-by-host":
        voice?.say("A host muted you. You can unmute yourself.", { priority: "assertive" });
        return;
      case "share-stopped-by-host":
        voice?.say("A host stopped your screen share.", { priority: "assertive" });
        return;
      case "removed":
        onOver({ kind: "removed" });
        return;
      case "replaced":
        onOver({ kind: "replaced" });
        return;
      case "ended":
        // Why it ended is the server's to say.
        void roomApi.get(meetingId).then((answer) => onOver(answer.ok ? ended(answer.value) : { kind: "ended", reason: null, cancelled: false }));
    }
  }), [client, voice, onOver, meetingId]);
}

/**
 * The recording (at once), the connection (lost at once, back politely), and people arriving and
 * leaving (gathered into one sentence, politely, while the person wants them said). `opened`: this
 * person's join opened the room.
 */
export function useRoomAnnouncements(state: RoomState, voice: LiveAnnouncerVoice | null, purpose: Meeting["purpose"], sayArrivals: boolean, opened: boolean) {
  const { recording, connection } = state;
  // A host who opened the room hears the recording start with it; anyone joining later was told before Join.
  const previousRecording = usePrevious(recording, opened ? "off" : recording);
  useEffect(() => {
    if (recording === previousRecording) return;
    const message = recordingAnnouncement(recording, purpose);
    if (message) voice?.say(message, { priority: "assertive" });
  }, [recording, previousRecording, voice, purpose]);

  const previousConnection = usePrevious(connection);
  useEffect(() => {
    if (connection === previousConnection) return;
    if (connection === "reconnecting") voice?.say("Connection lost. Trying to reconnect.", { priority: "assertive" });
    if (connection === "connected" && previousConnection === "reconnecting") voice?.say("Connected again.");
  }, [connection, previousConnection, voice]);

  // Who is in, by id: those already here when the room opens are not said.
  const previous = useRef<ReadonlyMap<string, string> | null>(null);
  const { participants } = state;
  useEffect(() => {
    const people = new Map(participants.filter((person) => !person.self).map((person) => [person.userId, person.name]));
    const before = previous.current ?? people;
    previous.current = people;
    if (!sayArrivals) return;
    for (const [id, name] of people) if (!before.has(id)) voice?.gather("joined", name, { id, sentence: (names) => groupSentence(names, "joined") });
    for (const [id, name] of before) if (!people.has(id)) voice?.gather("left", name, { id, sentence: (names) => groupSentence(names, "left") });
  }, [participants, sayArrivals, voice]);
}

/**
 * Since when a session or an event has had no host in it, as this tab saw it, or null. Everyone is
 * told at once when the last host goes; the server ends the call NO_HOST_END_MINUTES later.
 */
export function useNoHostSince(state: RoomState, purpose: Meeting["purpose"], hostHere: boolean, voice: LiveAnnouncerVoice | null, now: () => number): number | null {
  const [since, setSince] = useState<number | null>(null);
  const applies = endsWithoutHost(purpose) && state.connection === "connected";
  useEffect(() => {
    if (!applies) return;
    if (hostHere) {
      setSince(null);
      return;
    }
    setSince((current) => {
      if (current === null) voice?.say(noHostText(purpose), { priority: "assertive" });
      return current ?? now();
    });
  }, [applies, hostHere, purpose, voice, now]);
  return since;
}

/** The server's view of the call every ROOM_POLL_MS: its end, this person's seat, and the clock's offset. */
export function useMeetingPoll(meetingId: string, onMeeting: (meeting: Meeting, clockOffset: number) => void, onOver: (screen: OverScreen) => void) {
  const refresh = useCallback(async (signal?: AbortSignal) => {
    const sent = Date.now();
    const answer = await roomApi.get(meetingId, signal);
    if (!answer.ok) {
      if (answer.kind === "missing") onOver({ kind: "removed" });
      return;
    }
    const meeting = answer.value;
    if (meeting.you.seat === "REMOVED") return onOver({ kind: "removed" });
    if (meeting.state === "ENDED" || meeting.state === "CANCELLED") return onOver(ended(meeting));
    onMeeting(meeting, meeting.now - Math.round((sent + Date.now()) / 2));
  }, [meetingId, onMeeting, onOver]);
  useEffect(() => {
    const abort = new AbortController();
    const timer = setInterval(() => void refresh(abort.signal).catch(() => {}), ROOM_POLL_MS);
    return () => {
      abort.abort();
      clearInterval(timer);
    };
  }, [refresh]);
  return refresh;
}

/** Leaving the page mid-call asks first; if the person goes anyway, their seat is given back as the page goes. */
export function useLeaveGuard(meetingId: string) {
  useEffect(() => {
    const ask = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      // Older browsers ask only when a return value is set.
      event.returnValue = "";
    };
    const gone = () => void roomApi.leaveOnExit(meetingId).catch(() => {});
    window.addEventListener("beforeunload", ask);
    window.addEventListener("pagehide", gone);
    return () => {
      window.removeEventListener("beforeunload", ask);
      window.removeEventListener("pagehide", gone);
    };
  }, [meetingId]);
}
