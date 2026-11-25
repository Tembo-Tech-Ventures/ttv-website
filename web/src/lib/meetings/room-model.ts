import type { Meeting, MeetingEndReason, MeetingPurpose } from "@/lib/platform/contracts";
import type { RoomRecording } from "./room-client";
import { MAX_PEOPLE_PER_CALL, NO_HOST_END_MINUTES } from "./rules";

/**
 * The call room's rules and words, without React (README.md beside this file, "The room"): what the
 * page hands the island, which screen a call's state shows, and every sentence the room shows or says.
 * Import-free apart from types and rules.ts, so the island's chunk stays small and each rule is tested
 * on its own (room-model.test.ts).
 */

/** A room opens at most this long before its booked start (UX-REVIEW M7). The pre-join page holds Start until then. */
export const ROOM_OPENS_EARLY_MINUTES = 10;
/** How often the room asks the server about the call: waiting for a host, and once in it (ended, removed, the end time). */
export const WAITING_POLL_MS = 10_000;
export const ROOM_POLL_MS = 15_000;

/** What the server page hands the island. */
export interface CallRoomProps {
  meeting: Meeting;
  self: { userId: string; name: string; image: string | null };
  /** Everyone who hosts this call (who may open, remove and end it). A participant who is one of them is a host. */
  hostIds: readonly string[];
  /** The cohort's name, for a session. */
  cohortName: string | null;
  /** Where the call's chat lives: the card's thread, or the channel until a card is posted. */
  chat: { href: string; place: string };
  /** Where to go from the end screens. */
  back: { href: string; label: string };
  /** The month's recording limit was reached, so this call isn't recorded. */
  recordingRefused: boolean;
  /** Whether the person has agreed to the code of conduct, which joining needs. */
  conductAgreed: boolean;
  conductHref: string;
  /** Calls can't run here (no provider): the page says so and offers no Join. */
  unavailable: boolean;
  /** When the server drew the page, for the countdown before the browser's clock runs. */
  renderedAt: number;
}

export const NOUN: Record<MeetingPurpose, string> = { SESSION: "session", CALL: "call", CHECKIN: "check-in", EVENT: "event" };

/** "The session", as a countdown says it. */
export const subjectOf = (purpose: MeetingPurpose) => `The ${NOUN[purpose]}`;

/** The screens before a call, and after it. */
export type GateScreen =
  | { kind: "ready"; start: boolean }
  | { kind: "too-early"; opensAt: number }
  | { kind: "waiting" }
  | { kind: "closed" }
  | { kind: "ended"; reason: MeetingEndReason | null; cancelled: boolean }
  | { kind: "removed" }
  | { kind: "unavailable" };

/** Which screen the call shows before joining, from the server's view of it. */
export function gateScreen(meeting: Meeting, now: number, unavailable: boolean): GateScreen {
  if (meeting.you.seat === "REMOVED") return { kind: "removed" };
  if (meeting.state === "ENDED" || meeting.state === "CANCELLED") {
    return { kind: "ended", reason: meeting.endReason, cancelled: meeting.state === "CANCELLED" };
  }
  if (unavailable) return { kind: "unavailable" };
  if (meeting.state === "LIVE") return meeting.you.canJoin ? { kind: "ready", start: false } : { kind: "closed" };
  if (!meeting.you.canHost) return { kind: "waiting" };
  const opensAt = meeting.scheduledStartAt - ROOM_OPENS_EARLY_MINUTES * 60_000;
  if (now < opensAt) return { kind: "too-early", opensAt };
  return meeting.you.canJoin ? { kind: "ready", start: true } : { kind: "closed" };
}

/** The Join button's words. */
export function joinLabel(purpose: MeetingPurpose, start: boolean): string {
  return `${start ? "Start" : "Join"} ${NOUN[purpose]}`;
}

/**
 * What is recorded, said before Join (UX-REVIEW §6): a cohort session always, from start to end; an
 * event if its host chose; a call between two people is not recorded until consent is built (P11).
 */
export function recordingNotice(meeting: Meeting, cohortName: string | null, refused: boolean): { title: string; body: string } {
  const noun = NOUN[meeting.purpose];
  if (refused && meeting.recordingPolicy !== "NONE" && meeting.recordingPolicy !== "BOTH_AGREE") {
    return {
      title: `This ${noun} isn't recorded`,
      body: "TTV has reached its recording limit for this month, so nothing in this call is recorded.",
    };
  }
  switch (meeting.recordingPolicy) {
    case "ALWAYS": {
      const who = cohortName ? `Everyone in ${cohortName}` : "Everyone in the cohort";
      const live = meeting.state === "LIVE" && meeting.openedAt !== null;
      return {
        title: live ? `This ${noun} is being recorded, since ${nairobiTime(meeting.openedAt!)} EAT` : `This ${noun} is recorded`,
        body: `It's recorded from start to end. ${who} can watch it and read the transcript afterwards, and Tembo can answer questions about it. Your voice, your camera if it's on, and anything you share are in the recording. The chat isn't.`,
      };
    }
    case "HOST":
      return {
        title: `This ${noun} is recorded`,
        body: "By joining, you agree to be recorded. Everyone signed in to TTV can watch it afterwards. Your voice, your camera if it's on, and anything you share are in the recording.",
      };
    case "BOTH_AGREE":
    case "NONE":
      return { title: `This ${noun} isn't recorded`, body: "Nothing in this call is recorded." };
  }
}

/** Why a call ended, and where its recording will be (UX-REVIEW §3, row 11). */
export function endedText(meeting: Pick<Meeting, "title" | "purpose" | "limitMinutes" | "recordingPolicy">, reason: MeetingEndReason | null, cancelled: boolean, refused: boolean): { title: string; body: string } {
  const noun = NOUN[meeting.purpose];
  if (cancelled) return { title: `${meeting.title} was cancelled`, body: `This ${noun} didn't take place.` };
  const why: Record<MeetingEndReason, string> = {
    HOST_ENDED: `A host ended the ${noun}.`,
    LIMIT: `It reached its ${meeting.limitMinutes}-minute limit and ended.`,
    NO_HOST: `It ended because no host was here.`,
    NOBODY_CAME: "The other person didn't join, so the call closed. You can suggest another time.",
    EMPTY: "Everyone had left, so it closed.",
  };
  const recorded = meeting.recordingPolicy === "ALWAYS" || meeting.recordingPolicy === "HOST";
  const where = !recorded || refused || reason === "NOBODY_CAME"
    ? ""
    : meeting.purpose === "SESSION" ? " The recording will be in Sessions when it's ready." : " The recording will be in the channel when it's ready.";
  return { title: `${meeting.title} has ended`, body: `${reason ? why[reason] : ""}${where}`.trim() };
}

/** The recording chip's words, which always carry the state (never colour alone). */
export function recordingChip(recording: RoomRecording, refused: boolean): { label: string; tone: "danger" | "neutral" | "warning" } | null {
  if (refused) return { label: "Not recorded", tone: "neutral" };
  switch (recording) {
    case "recording": return { label: "Recording", tone: "danger" };
    case "failed": return { label: "Recording stopped working", tone: "warning" };
    case "stopped": return { label: "Recording stopped", tone: "neutral" };
    case "off": return null;
  }
}

/** What is said, at once, when the recording changes (UX-REVIEW §5). */
export function recordingAnnouncement(recording: RoomRecording, purpose: MeetingPurpose): string | null {
  switch (recording) {
    case "recording": return "Recording started";
    case "stopped": return "Recording stopped";
    case "failed": return `Recording stopped working. The ${NOUN[purpose]} carries on, but the rest isn't being recorded.`;
    case "off": return null;
  }
}

export const NO_HOST_MS = NO_HOST_END_MINUTES * 60_000;

/** The notice everyone sees while a session or event has no host (UX-REVIEW M8). */
export function noHostText(purpose: MeetingPurpose): string {
  return `No host is here. The ${NOUN[purpose]} ends in ${NO_HOST_END_MINUTES} minutes unless a host comes back.`;
}

/** Whether a call ends when no host is in it: sessions and events, where hosts are distinct from members. */
export const endsWithoutHost = (purpose: MeetingPurpose) => purpose === "SESSION" || purpose === "EVENT";

export const fullText = (purpose: MeetingPurpose, recorded: boolean) => ({
  title: `This ${NOUN[purpose]} is full`,
  body: `Up to ${MAX_PEOPLE_PER_CALL} people can be in a call, with one place kept for a host.${recorded && purpose === "SESSION" ? " You can watch the recording in Sessions afterwards." : ""} A place opens when someone leaves.`,
});

export const removedText = (purpose: MeetingPurpose) => ({
  title: `A host removed you from this ${NOUN[purpose]}`,
  body: `You can't rejoin it. If you think this was a mistake, tell the ${purpose === "SESSION" ? "cohort's staff" : "host"}.`,
});

/** The pre-join line for a host before the room may open. */
export const tooEarlyText = (purpose: MeetingPurpose, opensAt: string) =>
  `You can start this ${NOUN[purpose]} from ${opensAt} EAT, ${ROOM_OPENS_EARLY_MINUTES} minutes before it begins.`;

export const waitingText = (purpose: MeetingPurpose) => ({
  title: `A host hasn't started the ${NOUN[purpose]} yet`,
  body: "Keep this page open: you can join as soon as it starts.",
});

export const startedAnnouncement = (purpose: MeetingPurpose) => `The ${NOUN[purpose]} has started. You can join now.`;

/** "3 people", "1 person". */
export const peopleCount = (count: number) => `${count} ${count === 1 ? "person" : "people"}`;

/** "Faith Njeri", "You", with "host" said beside it. */
export function personLabel(name: string, { self, host }: { self: boolean; host: boolean }): string {
  return [self ? `${name} (you)` : name, host ? "host" : null].filter(Boolean).join(", ");
}

/** A time in Nairobi, "18:04". */
export function nairobiTime(at: number): string {
  return new Intl.DateTimeFormat("en-GB", { hour: "2-digit", minute: "2-digit", timeZone: "Africa/Nairobi" }).format(at);
}

/** The screens after a call, each a page whose h1 takes focus. */
export type OverScreen =
  | { kind: "ended"; reason: MeetingEndReason | null; cancelled: boolean }
  | { kind: "removed" }
  | { kind: "full" }
  | { kind: "left" }
  | { kind: "replaced" };

/** What is said, at once, as each end screen appears (the screen's h1 also takes focus). */
export function overAnnouncement(screen: OverScreen, meeting: Pick<Meeting, "title" | "purpose" | "limitMinutes" | "recordingPolicy">): string {
  switch (screen.kind) {
    case "ended": return endedText(meeting, screen.reason, screen.cancelled, false).title;
    case "removed": return removedText(meeting.purpose).title;
    case "full": return fullText(meeting.purpose, false).title;
    case "left": return `You left the ${NOUN[meeting.purpose]}`;
    case "replaced": return `You joined this ${NOUN[meeting.purpose]} somewhere else`;
  }
}
