import type { CallProviderKind } from "./rules";

/**
 * The boundary between the call room (the `CallRoom` island) and the media provider in the browser
 * (README.md beside this file, "The room"). The island talks only to this interface: it never
 * imports a provider SDK. Each implementation is loaded with a dynamic import when someone presses
 * Join (`loadRoomClient`), so a provider's SDK lives in its own chunk, never in the island's.
 *
 * - `fake-room-client.ts` serves local runs, tests and previews, where the server's provider is the
 *   fake (`provider.ts`): the person's own camera and microphone are real, and who else is in the call
 *   comes from TTV's own seats.
 * - The RealtimeKit client (slice P6) implements the same interface with the Core SDK.
 *
 * TTV, not the provider, decides who may be in a call and who hosts it: a participant is known by
 * their TTV user id (the provider participant's custom id), and the island knows the call's hosts
 * from the server. Removing someone and ending the call are TTV API calls, never provider calls from
 * a browser.
 */

/** What the person chose on the device check before joining. */
export interface MediaChoice {
  /** The microphone's deviceId, or null for the browser's default. */
  microphoneId: string | null;
  /** The camera's deviceId, or null for the browser's default. */
  cameraId: string | null;
  /** Join with the microphone on. */
  microphoneOn: boolean;
  /** Join with the camera on. */
  cameraOn: boolean;
  /** Low data: no camera, and nobody's video is received; shared screens still are. */
  audioOnly: boolean;
}

/** The connection to the media servers. */
export type RoomConnection = "connecting" | "connected" | "reconnecting" | "disconnected";

/**
 * Whether the call is being recorded, as the provider reports it: `off` before a recording starts (or
 * where nothing is recorded), `recording`, `stopped` after it ended normally, `failed` when it stopped
 * working. Recordings are started and stopped by the server only (ARCHITECTURE §4.4).
 */
export type RoomRecording = "off" | "recording" | "stopped" | "failed";

/** One person in the call, as the provider sees them. */
export interface RoomParticipant {
  /** Their TTV user id. */
  userId: string;
  name: string;
  /** Whether this is the person using this tab. */
  self: boolean;
  microphoneOn: boolean;
  cameraOn: boolean;
  speaking: boolean;
  sharing: boolean;
  /** Their camera, when it is on and received here. */
  video: MediaStreamTrack | null;
  /** What they share, when they share and it is received here (or this tab's own share). */
  screen: MediaStreamTrack | null;
}

export interface RoomState {
  connection: RoomConnection;
  /** Everyone in the call, this tab's person first. */
  participants: readonly RoomParticipant[];
  recording: RoomRecording;
}

/**
 * Something that happened to this tab's person, said to them at once: a host muted them or stopped
 * their share, they were removed (their participant was deleted), the call was ended for everyone,
 * or another tab of theirs took their seat.
 */
export type RoomNotice = "muted-by-host" | "share-stopped-by-host" | "removed" | "ended" | "replaced";

export type RoomListener = (state: RoomState) => void;
export type RoomNoticeListener = (notice: RoomNotice) => void;

/** Why screen sharing failed to start: the person cancelled the picker, the browser refused, or it can't share at all. */
export class ScreenShareError extends Error {
  constructor(readonly reason: "cancelled" | "refused" | "unsupported" | "taken", message: string) {
    super(message);
    this.name = "ScreenShareError";
  }
}

export interface RoomClient {
  readonly kind: CallProviderKind;
  /** Whether this browser can share a screen at all. Phone browsers can't: the room says so. */
  readonly canShareScreen: boolean;
  /**
   * Connects with the token the join route returned, publishing the chosen tracks. Rejects (and has
   * already released every track it opened) when it can't connect.
   */
  join(input: { token: string; self: { userId: string; name: string }; media: MediaChoice }): Promise<void>;
  /** Disconnects and releases every track and subscription. Safe to call more than once. */
  leave(): Promise<void>;
  setMicrophone(on: boolean): Promise<void>;
  setCamera(on: boolean): Promise<void>;
  /** Shares a screen, window or tab; rejects with a ScreenShareError. One share at a time in a call. */
  startScreenShare(): Promise<void>;
  stopScreenShare(): Promise<void>;
  /** A host mutes someone; they can unmute themselves. */
  muteParticipant(userId: string): Promise<void>;
  /** A host stops someone's screen share. */
  stopParticipantShare(userId: string): Promise<void>;
  getState(): RoomState;
  subscribe(listener: RoomListener): () => void;
  onNotice(listener: RoomNoticeListener): () => void;
}

/** What a client needs from the page: the call, and (for the fake) where its presence comes from. */
export interface RoomClientOptions {
  meetingId: string;
}

/**
 * The client for the provider that minted the token. A dynamic import, so neither the fake nor the
 * real SDK is in the island's own chunk. The real one is slice P6: until then a RealtimeKit token
 * can't be used here, and the room says the call can't connect.
 */
export async function loadRoomClient(kind: CallProviderKind, options: RoomClientOptions): Promise<RoomClient> {
  switch (kind) {
    case "fake": {
      const { FakeRoomClient } = await import("./fake-room-client");
      return new FakeRoomClient(options);
    }
    case "realtimekit":
      throw new Error("This browser client for calls isn't built yet.");
  }
}
