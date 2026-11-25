import { audioMeter } from "./devices";
import { FAKE_PRESENCE_PATH, type FakePresence } from "./fake-presence";
import {
  ScreenShareError,
  type MediaChoice, type RoomClient, type RoomClientOptions, type RoomConnection, type RoomListener, type RoomNotice,
  type RoomNoticeListener, type RoomParticipant, type RoomRecording, type RoomState,
} from "./room-client";

/**
 * The room client for the fake provider (room-client.ts): local runs, tests and previews. It does
 * what a browser can do alone and is honest about the rest:
 *
 * - This tab's camera, microphone and screen share are real tracks from the browser, opened with the
 *   person's choices and released on leave.
 * - Who else is in the call comes from TTV's own seats (`GET /api/meetings/:id/presence`, which
 *   exists only where calls run on the fake), polled every few seconds. Their media can't travel
 *   without a media server, so they appear with their microphone on and no video.
 * - The call's recording is what the server says: a cohort session records from its first second.
 * - A seat the server marked removed, or a call it ended, reaches this tab as the notice a real
 *   provider would send.
 *
 * Tests (and the preview's browser checks) drive what only a real provider would cause through the
 * `simulate*` methods; `window.__ttvFakeRoom` is the joined client.
 */

declare global {
  interface Window { __ttvFakeRoom?: FakeRoomClient }
}

/** How often the fake asks who is in the call. */
export const FAKE_PRESENCE_INTERVAL_MS = 3_000;
/** How often the fake listens for this tab's person speaking, and how loud counts. */
const SPEAKING_INTERVAL_MS = 250;
const SPEAKING_LEVEL = 0.04;

type Media = Pick<MediaDevices, "getUserMedia"> & Partial<Pick<MediaDevices, "getDisplayMedia">>;

export interface FakeRoomClientOptions extends RoomClientOptions {
  /** The browser's media devices (tests pass their own). */
  media?: Media | null;
  /** Reads the call's presence (tests pass their own). */
  presence?: (meetingId: string, signal: AbortSignal) => Promise<FakePresence | null>;
  /** How often to read it. */
  intervalMs?: number;
  /** Measures how loud a microphone is, 0–1; null where the browser can't. */
  meter?: (track: MediaStreamTrack) => { level(): number; close(): void } | null;
}

const EMPTY: RoomState = Object.freeze({ connection: "connecting", participants: [], recording: "off" });

async function readPresence(meetingId: string, signal: AbortSignal): Promise<FakePresence | null> {
  const response = await fetch(FAKE_PRESENCE_PATH.replace(":id", encodeURIComponent(meetingId)), {
    credentials: "same-origin", headers: { accept: "application/json" }, signal,
  });
  if (response.status === 404) return null;
  if (!response.ok) throw new Error(`Presence answered ${response.status}.`);
  return await response.json() as FakePresence;
}

export class FakeRoomClient implements RoomClient {
  readonly kind = "fake" as const;
  readonly canShareScreen: boolean;
  readonly #meetingId: string;
  readonly #media: Media | null;
  readonly #presence: NonNullable<FakeRoomClientOptions["presence"]>;
  readonly #intervalMs: number;
  readonly #meter: NonNullable<FakeRoomClientOptions["meter"]>;
  readonly #listeners = new Set<RoomListener>();
  readonly #noticeListeners = new Set<RoomNoticeListener>();
  #state: RoomState = EMPTY;
  #self: { userId: string; name: string } | null = null;
  #audioOnly = false;
  #microphone: MediaStreamTrack | null = null;
  #camera: MediaStreamTrack | null = null;
  #screen: MediaStreamTrack | null = null;
  #choice: MediaChoice | null = null;
  #others: readonly RoomParticipant[] = [];
  #speaking = false;
  #levels: { level(): number; close(): void } | null = null;
  #timers: ReturnType<typeof setInterval>[] = [];
  /** A device being opened: a second press waits for it rather than opening (and leaking) another track. */
  readonly #opening = new Map<"microphone" | "camera" | "screen", Promise<void>>();
  #abort = new AbortController();
  #left = false;
  /** Set by a simulated connection or recording state: polling doesn't override them. */
  #connectionHeld = false;
  #recordingHeld = false;

  constructor({ meetingId, media, presence, intervalMs = FAKE_PRESENCE_INTERVAL_MS, meter = audioMeter }: FakeRoomClientOptions) {
    this.#meetingId = meetingId;
    this.#media = media === undefined ? (globalThis.navigator?.mediaDevices ?? null) : media;
    this.#presence = presence ?? readPresence;
    this.#intervalMs = intervalMs;
    this.#meter = meter;
    this.canShareScreen = typeof this.#media?.getDisplayMedia === "function";
  }

  getState(): RoomState {
    return this.#state;
  }

  subscribe(listener: RoomListener): () => void {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  }

  onNotice(listener: RoomNoticeListener): () => void {
    this.#noticeListeners.add(listener);
    return () => this.#noticeListeners.delete(listener);
  }

  async join({ self, media }: Parameters<RoomClient["join"]>[0]): Promise<void> {
    if (this.#left) throw new Error("This room client has left; make a new one.");
    this.#self = self;
    this.#choice = media;
    this.#audioOnly = media.audioOnly;
    try {
      // A device the browser refuses now leaves it off, as a real client joins without it.
      if (media.microphoneOn) await this.#once("microphone", () => this.#openMicrophone()).catch(() => {});
      if (media.cameraOn && !media.audioOnly) await this.#once("camera", () => this.#openCamera()).catch(() => {});
      const presence = await this.#presence(this.#meetingId, this.#abort.signal);
      if (!presence || presence.you !== "HELD") throw new Error("This seat isn't held.");
      this.#applyPresence(presence);
    } catch (error) {
      await this.leave();
      throw error;
    }
    this.#timers.push(setInterval(() => void this.#poll(), this.#intervalMs));
    this.#timers.push(setInterval(() => this.#listen(), SPEAKING_INTERVAL_MS));
    this.#set({ connection: "connected" });
    if (typeof window !== "undefined") window.__ttvFakeRoom = this;
  }

  async leave(): Promise<void> {
    if (this.#left) return;
    this.#left = true;
    this.#abort.abort();
    for (const timer of this.#timers.splice(0)) clearInterval(timer);
    this.#levels?.close();
    this.#levels = null;
    for (const track of [this.#microphone, this.#camera, this.#screen]) track?.stop();
    this.#microphone = this.#camera = this.#screen = null;
    if (typeof window !== "undefined" && window.__ttvFakeRoom === this) delete window.__ttvFakeRoom;
    this.#set({ connection: "disconnected", participants: [] });
    this.#listeners.clear();
    this.#noticeListeners.clear();
  }

  /** Whether every track this client opened has been released: the cleanup tests read it. */
  get released(): boolean {
    return [this.#microphone, this.#camera, this.#screen].every((track) => track === null) && this.#timers.length === 0;
  }

  async setMicrophone(on: boolean): Promise<void> {
    // Off waits for an open under way, so a quick on-off ends off.
    if (!on) await this.#opening.get("microphone")?.catch(() => {});
    if (on && !this.#microphone) await this.#once("microphone", () => this.#openMicrophone());
    if (this.#microphone) this.#microphone.enabled = on;
    this.#publish();
  }

  async setCamera(on: boolean): Promise<void> {
    if (this.#audioOnly) return;
    if (!on) await this.#opening.get("camera")?.catch(() => {});
    if (on && !this.#camera) await this.#once("camera", () => this.#openCamera());
    if (!on && this.#camera) {
      // A camera turned off is released, so its light goes out.
      this.#camera.stop();
      this.#camera = null;
    }
    this.#publish();
  }

  async startScreenShare(): Promise<void> {
    if (this.#screen) return;
    return this.#once("screen", () => this.#share());
  }

  async #share(): Promise<void> {
    if (!this.canShareScreen || !this.#media?.getDisplayMedia) throw new ScreenShareError("unsupported", "This browser can't share a screen.");
    const sharer = this.#others.find(({ sharing }) => sharing);
    if (sharer) throw new ScreenShareError("taken", `${sharer.name} is sharing.`);
    let stream: MediaStream;
    try {
      stream = await this.#media.getDisplayMedia({ video: true, audio: false });
    } catch (error) {
      const name = error instanceof Error ? error.name : "";
      throw new ScreenShareError(name === "NotAllowedError" ? "cancelled" : "refused", "The screen wasn't shared.");
    }
    if (this.#left) {
      for (const track of stream.getTracks()) track.stop();
      return;
    }
    const [track] = stream.getVideoTracks();
    this.#screen = track ?? null;
    // The browser's own "Stop sharing" bar ends the track.
    track?.addEventListener("ended", () => void this.stopScreenShare());
    this.#publish();
  }

  async stopScreenShare(): Promise<void> {
    this.#screen?.stop();
    this.#screen = null;
    this.#publish();
  }

  async muteParticipant(userId: string): Promise<void> {
    this.#others = this.#others.map((person) => person.userId === userId ? { ...person, microphoneOn: false, speaking: false } : person);
    this.#publish();
  }

  async stopParticipantShare(userId: string): Promise<void> {
    this.#others = this.#others.map((person) => person.userId === userId ? { ...person, sharing: false, screen: null } : person);
    this.#publish();
  }

  // What only a real provider causes, for tests and the preview's browser checks.

  /** The connection drops or comes back. */
  simulateConnection(connection: RoomConnection): void {
    this.#connectionHeld = connection !== "connected";
    this.#set({ connection });
  }

  /** The recording starts, stops or fails. */
  simulateRecording(recording: RoomRecording): void {
    this.#recordingHeld = true;
    this.#set({ recording });
  }

  /** Something happens to this tab's person: a host muted them or stopped their share. */
  simulateNotice(notice: RoomNotice): void {
    if (notice === "muted-by-host") void this.setMicrophone(false);
    if (notice === "share-stopped-by-host") void this.stopScreenShare();
    this.#notify(notice);
  }

  /** Someone else's state changes (speaking, sharing, muted). */
  simulateParticipant(userId: string, change: Partial<Pick<RoomParticipant, "microphoneOn" | "cameraOn" | "speaking" | "sharing">>): void {
    this.#others = this.#others.map((person) => person.userId === userId ? { ...person, ...change } : person);
    this.#publish();
  }

  /** Runs `open` unless the same device is already being opened, in which case it waits for that. */
  #once(device: "microphone" | "camera" | "screen", open: () => Promise<void>): Promise<void> {
    const running = this.#opening.get(device);
    if (running) return running;
    const opened = open().finally(() => this.#opening.delete(device));
    this.#opening.set(device, opened);
    return opened;
  }

  async #openMicrophone() {
    if (!this.#media) throw new DOMException("No media devices.", "NotFoundError");
    const stream = await this.#media.getUserMedia({ audio: this.#choice?.microphoneId ? { deviceId: { exact: this.#choice.microphoneId } } : true });
    const [track] = stream.getAudioTracks();
    // Opened after leaving: released at once, never kept.
    if (this.#left) return track?.stop();
    this.#microphone = track ?? null;
    if (this.#microphone) this.#levels = this.#meter(this.#microphone);
  }

  async #openCamera() {
    if (!this.#media) throw new DOMException("No media devices.", "NotFoundError");
    const stream = await this.#media.getUserMedia({ video: this.#choice?.cameraId ? { deviceId: { exact: this.#choice.cameraId } } : true });
    const [track] = stream.getVideoTracks();
    if (this.#left) return track?.stop();
    this.#camera = track ?? null;
  }

  async #poll() {
    try {
      const presence = await this.#presence(this.#meetingId, this.#abort.signal);
      if (this.#left) return;
      if (!presence) return this.#notify("ended");
      this.#applyPresence(presence);
      if (!this.#connectionHeld && this.#state.connection !== "connected") this.#set({ connection: "connected" });
    } catch {
      // A failed read is a dropped connection until the next one works.
      if (!this.#left && this.#state.connection === "connected") this.#set({ connection: "reconnecting" });
    }
  }

  #applyPresence(presence: FakePresence) {
    if (presence.state !== "LIVE") return this.#notify("ended");
    if (presence.you === "REMOVED") return this.#notify("removed");
    if (presence.you !== "HELD") return this.#notify("replaced");
    const known = new Map(this.#others.map((person) => [person.userId, person]));
    this.#others = presence.people
      .filter(({ userId }) => userId !== this.#self?.userId)
      .map(({ userId, name }) => known.get(userId) ?? {
        userId, name, self: false, microphoneOn: true, cameraOn: false, speaking: false, sharing: false, video: null, screen: null,
      });
    if (!this.#recordingHeld) this.#set({ recording: presence.recording });
    this.#publish();
  }

  #listen() {
    const speaking = Boolean(this.#microphone?.enabled && this.#levels && this.#levels.level() > SPEAKING_LEVEL);
    if (speaking === this.#speaking) return;
    this.#speaking = speaking;
    this.#publish();
  }

  #publish() {
    if (this.#left || !this.#self) return;
    const self: RoomParticipant = {
      ...this.#self,
      self: true,
      microphoneOn: Boolean(this.#microphone?.enabled),
      cameraOn: this.#camera !== null,
      speaking: this.#speaking,
      sharing: this.#screen !== null,
      video: this.#camera,
      screen: this.#screen,
    };
    this.#set({ participants: [self, ...this.#others] });
  }

  #set(change: Partial<RoomState>) {
    this.#state = { ...this.#state, ...change };
    for (const listener of this.#listeners) listener(this.#state);
  }

  #notify(notice: RoomNotice) {
    for (const listener of this.#noticeListeners) listener(notice);
  }
}
