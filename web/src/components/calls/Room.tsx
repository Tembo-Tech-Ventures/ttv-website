import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { PiRecord } from "react-icons/pi";
import { Button, Chip, Countdown, Dialog, FOCUS_RING, Notice, cx, useAnnouncer } from "@/components/platform/ui";
import type { Meeting } from "@/lib/platform/contracts";
import { roomApi } from "@/lib/meetings/room-api";
import { ScreenShareError, type RoomClient, type RoomParticipant } from "@/lib/meetings/room-client";
import {
  NO_HOST_MS, NOUN, noHostText, peopleCount, recordingChip, subjectOf, type CallRoomProps, type OverScreen,
} from "@/lib/meetings/room-model";
import { NO_HOST_END_MINUTES } from "@/lib/meetings/rules";
import RoomControls, { controlFor, type Panel } from "./RoomControls";
import RoomPanel from "./RoomPanel";
import RoomStage from "./RoomStage";
import { useLeaveGuard, useMeetingPoll, useNoHostSince, useRoomAnnouncements, useRoomNotices, useRoomState } from "./room-hooks";

/**
 * The call itself (UX-REVIEW §3 screens 07–10, §5). The top bar (the call's name, the recording,
 * when it ends, how many are in), the stage, the controls and one side panel, in that reading order,
 * after a "Skip to call controls" link. On a phone the stage takes the full width, the controls stay
 * at the bottom and a panel covers the stage. Nothing here decides a call's end: the server does,
 * and the room asks it (room-hooks.ts).
 */

export interface RoomProps {
  room: CallRoomProps;
  meeting: Meeting;
  client: RoomClient;
  /** The server's clock minus this browser's, for the countdowns. */
  clockOffset: number;
  audioOnly: boolean;
  /** This person's join opened the room. */
  opened: boolean;
  onMeeting: (meeting: Meeting, clockOffset: number) => void;
  onOver: (screen: OverScreen) => void;
}

/** A note in the stage that the person dismisses: why sharing didn't start. */
type StageNote = { tone: "info" | "warning"; title: string; body: string };

export default function Room({ room, meeting, client, clockOffset, audioOnly, opened, onMeeting, onOver }: RoomProps) {
  const voice = useAnnouncer();
  const state = useRoomState(client);
  const noun = NOUN[meeting.purpose];
  const hosts = useMemo(() => new Set(room.hostIds), [room.hostIds]);
  const isHost = meeting.you.canHost;
  const now = useCallback(() => Date.now() + clockOffset, [clockOffset]);
  const self = state.participants.find((person) => person.self);
  const otherHostHere = state.participants.some((person) => !person.self && hosts.has(person.userId));

  const [panel, setPanel] = useState<Panel | null>(null);
  const [ending, setEnding] = useState(false);
  const [removing, setRemoving] = useState<RoomParticipant | null>(null);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<StageNote | null>(null);
  const [failed, setFailed] = useState<string | null>(null);
  const [sayArrivals, setSayArrivals] = useState(true);
  const heading = useRef<HTMLHeadingElement>(null);
  const panelHeading = useRef<HTMLHeadingElement>(null);

  // Arriving in the room, the screen reader starts at the call's name.
  useEffect(() => heading.current?.focus(), []);
  useRoomNotices(client, voice, meeting.id, onOver);
  useRoomAnnouncements(state, voice, meeting.purpose, sayArrivals, opened);
  const noHostSince = useNoHostSince(state, meeting.purpose, isHost || otherHostHere, voice, now);
  const refresh = useMeetingPoll(meeting.id, onMeeting, onOver);
  useLeaveGuard(meeting.id);

  async function leave() {
    setBusy(true);
    await client.leave();
    await roomApi.leave(meeting.id);
    onOver({ kind: "left" });
  }

  async function end() {
    setBusy(true);
    const answer = await roomApi.end(meeting.id);
    if (!answer.ok) {
      setBusy(false);
      setEnding(false);
      setFailed(`The ${noun} didn't end: the call service didn't answer. Try again in a moment.`);
      return;
    }
    await client.leave();
    onOver({ kind: "ended", reason: answer.value.endReason ?? "HOST_ENDED", cancelled: false });
  }

  async function remove(person: RoomParticipant) {
    setRemoving(null);
    const answer = await roomApi.remove(meeting.id, person.userId);
    if (answer.ok) voice?.say(`${person.name} was removed from the ${noun}.`);
    else setFailed(`${person.name} wasn't removed: the call service didn't answer. Try again in a moment.`);
  }

  async function share() {
    if (self?.sharing) return client.stopScreenShare();
    if (!client.canShareScreen) {
      // Said, never hidden: a phone browser can't share a screen (UX-REVIEW §3 row 09).
      setNote({ tone: "info", title: "This browser can't share a screen", body: "Phone browsers can't share a screen. Join from a computer to share yours." });
      return voice?.say("This browser can't share a screen. Join from a computer to share yours.");
    }
    try {
      await client.startScreenShare();
      setNote(null);
    } catch (error) {
      if (!(error instanceof ScreenShareError) || error.reason === "cancelled") return;
      const body = error.reason === "taken" ? `${error.message} You can share when they stop.` : "Your browser didn't let TTV share the screen. Check its settings and try again.";
      setNote({ tone: "warning", title: "Your screen isn't shared", body });
      voice?.say(`Your screen isn't shared. ${body}`);
    }
  }

  // Focus goes back to the panel's button as it closes.
  const closePanel = useCallback(() => {
    if (panel) controlFor(panel)?.focus();
    setPanel(null);
  }, [panel]);

  const chip = recordingChip(state.recording, room.recordingRefused);
  const notices = (
    <StageNotices
      purpose={meeting.purpose} reconnecting={state.connection === "reconnecting"} recordingFailed={state.recording === "failed"}
      noHostSince={noHostSince} now={now} failed={failed} note={note} onDismiss={() => setNote(null)}
    />
  );

  return (
    <div
      data-call-room
      className="relative grid h-full min-h-0 w-full flex-1 grid-cols-1 grid-rows-[auto_minmax(0,1fr)_auto] [grid-template-areas:'top'_'stage'_'controls'] lg:grid-cols-[minmax(0,1fr)_22rem] lg:[grid-template-areas:'top_top'_'stage_panel'_'controls_controls']"
    >
      <a
        href="#call-controls"
        className={cx("sr-only focus:not-sr-only focus:absolute focus:top-2 focus:left-2 focus:z-30 focus:rounded-md focus:bg-ground focus:p-2 focus:text-ink-primary", FOCUS_RING)}
      >
        Skip to call controls
      </a>
      <header className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1 border-b border-hairline px-3 py-2 [grid-area:top] sm:px-4">
        <h1 ref={heading} tabIndex={-1} className="sr-only">{meeting.title}</h1>
        <p aria-hidden="true" className="m-0 min-w-0 flex-1 basis-40 truncate font-semibold text-ink-primary">{meeting.title}</p>
        {chip && <Chip tone={chip.tone} icon={chip.tone === "danger" ? <PiRecord /> : undefined}>{chip.label}</Chip>}
        {meeting.hardEndAt !== null && (
          <Countdown
            endsAt={meeting.hardEndAt} warnings={meeting.purpose === "CHECKIN" ? "check-in" : "call"} subject={subjectOf(meeting.purpose)}
            now={now} renderedAt={room.renderedAt} onEnd={() => void refresh().catch(() => {})} className="text-sm"
          />
        )}
        <p className="m-0 text-sm text-ink-secondary" data-call-count>{peopleCount(state.participants.length)}</p>
      </header>

      <RoomStage participants={state.participants} hosts={hosts} audioOnly={audioOnly} notices={notices} />

      <RoomControls
        microphoneOn={self?.microphoneOn ?? false} cameraOn={self?.cameraOn ?? false} sharing={self?.sharing ?? false}
        audioOnly={audioOnly} panel={panel} leaveLabel={isHost ? "Leave or end" : `Leave ${noun}`} leaving={busy && !ending}
        onMicrophone={() => void client.setMicrophone(!(self?.microphoneOn ?? false))}
        onCamera={() => void client.setCamera(!(self?.cameraOn ?? false))}
        onShare={() => void share()}
        onPanel={(next) => setPanel((open) => (open === next ? null : next))}
        onLeave={() => (isHost ? setEnding(true) : void leave())}
      />

      {panel && (
        <RoomPanel
          panel={panel} purpose={meeting.purpose} participants={state.participants} hosts={hosts} isHost={isHost} chat={room.chat}
          sayArrivals={sayArrivals} onSayArrivals={setSayArrivals} onClose={closePanel} heading={panelHeading}
          onMute={(person) => void client.muteParticipant(person.userId)}
          onStopShare={(person) => void client.stopParticipantShare(person.userId)}
          onRemove={setRemoving}
        />
      )}

      <EndDialog
        open={ending} title={meeting.title} noun={noun} recording={state.recording === "recording"} otherHostHere={otherHostHere} busy={busy}
        onClose={() => setEnding(false)} onEnd={() => void end()} onLeave={() => void leave()}
      />

      <Dialog
        id="call-remove" open={removing !== null} onClose={() => setRemoving(null)} returnFocus={panelHeading}
        title={`Remove ${removing?.name ?? "them"} from this ${noun}?`}
        actions={<Button variant="danger" onClick={() => removing && void remove(removing)}>Remove</Button>}
      >
        <p className="m-0">They leave at once and can't rejoin this {noun}.</p>
      </Dialog>
    </div>
  );
}

function StageNotices({ purpose, reconnecting, recordingFailed, noHostSince, now, failed, note, onDismiss }: {
  purpose: Meeting["purpose"];
  reconnecting: boolean;
  recordingFailed: boolean;
  noHostSince: number | null;
  now: () => number;
  failed: string | null;
  note: StageNote | null;
  onDismiss: () => void;
}) {
  const noun = NOUN[purpose];
  return (
    <>
      {reconnecting && <Notice tone="warning" title="Reconnecting…" announce="none">Your connection dropped. You're still in the {noun}.</Notice>}
      {noHostSince !== null && (
        <Notice tone="warning" title={noHostText(purpose)} announce="none">
          <Countdown endsAt={noHostSince + NO_HOST_MS} warnings={[{ at: 60, priority: "assertive" }]} subject={subjectOf(purpose)} now={now} showEndTime={false} />
        </Notice>
      )}
      {recordingFailed && (
        <Notice tone="warning" title="Recording stopped working" announce="none">The {noun} carries on, but the rest of it isn't being recorded.</Notice>
      )}
      {failed && <Notice tone="danger" title="That didn't work">{failed}</Notice>}
      {note && (
        <Notice tone={note.tone} title={note.title} announce="none" actions={<Button size="sm" variant="ghost" onClick={onDismiss}>Dismiss</Button>}>
          {note.body}
        </Notice>
      )}
    </>
  );
}

/**
 * A host's way out (UX-REVIEW §3 row 08, M8): end for everyone, just leave while another host is in,
 * or keep going (the way out, which takes focus, so Enter never ends the call by accident).
 */
function EndDialog({ open, title, noun, recording, otherHostHere, busy, onClose, onEnd, onLeave }: {
  open: boolean; title: string; noun: string; recording: boolean; otherHostHere: boolean; busy: boolean;
  onClose: () => void; onEnd: () => void; onLeave: () => void;
}) {
  return (
    <Dialog
      id="call-end" open={open} onClose={onClose} cancelLabel="Keep going" title={`End ${title} for everyone?`}
      actions={
        <>
          <Button variant="danger" onClick={onEnd} loading={busy}>End for everyone</Button>
          {otherHostHere && <Button onClick={onLeave} disabled={busy}>Just leave</Button>}
        </>
      }
    >
      <p className="m-0">
        {`Everyone leaves the ${noun}${recording ? " and the recording stops" : ""}. Nobody can rejoin it. `}
        {otherHostHere
          ? "If you just leave, another host keeps it going."
          : `You're the only host here: if you left, it would end ${NO_HOST_END_MINUTES} minutes later without you.`}
      </p>
    </Dialog>
  );
}
