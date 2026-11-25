import type { RoomRecording } from "./room-client";
import type { MeetingRecordingPolicy, MeetingRecordingState, MeetingSeatState, MeetingState } from "./rules";

/**
 * Who is in a call, for the fake room client (fake-room-client.ts) only. A real provider tells its
 * browser client who is in the room; the fake has no media server, so it asks TTV, whose seats are
 * the record of who may be in a call anyway. The route answers only where calls run on the fake
 * provider (local runs, tests, previews), and only to someone with a seat in the live call (a call
 * that is over says only that): everyone else, and production, get the same 404 as every meeting
 * route. Import-free apart from types, so the island's chunk can share it.
 */

export const FAKE_PRESENCE_PATH = "/api/meetings/:id/presence";

export interface FakePresence {
  state: MeetingState;
  /** The caller's own seat. */
  you: MeetingSeatState | null;
  recording: RoomRecording;
  /** Everyone holding a seat, in the order they took it. */
  people: { userId: string; name: string }[];
}

/**
 * The recording as a provider would report it: the call's recording row when there is one; otherwise
 * a call recorded ALWAYS records from the first second its room is open (the provider's
 * record_on_start), and any other call is not recorded.
 */
export function presenceRecording(policy: MeetingRecordingPolicy, state: MeetingState, recording: MeetingRecordingState | null): RoomRecording {
  switch (recording) {
    case "STARTING":
    case "RECORDING":
      return "recording";
    case "STOPPED":
    case "PROMOTED":
    case "TOO_SHORT":
      return "stopped";
    case "FAILED":
      return "failed";
    case "REFUSED":
      return "off";
    case null:
      return policy === "ALWAYS" && state === "LIVE" ? "recording" : "off";
  }
}
