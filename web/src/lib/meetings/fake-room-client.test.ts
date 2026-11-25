import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { FakePresence } from "./fake-presence";
import { FakeRoomClient, FAKE_PRESENCE_INTERVAL_MS } from "./fake-room-client";
import { ScreenShareError, type MediaChoice, type RoomNotice } from "./room-client";

/** A fake browser track: stopped is what releasing it means. */
function track(kind: "audio" | "video") {
  const listeners = new Map<string, () => void>();
  return {
    kind, enabled: true, stopped: false,
    stop() { this.stopped = true; },
    addEventListener(type: string, listener: () => void) { listeners.set(type, listener); },
    end() { listeners.get("ended")?.(); },
  };
}
type Track = ReturnType<typeof track>;

function stream(tracks: Track[]) {
  return {
    getTracks: () => tracks, getAudioTracks: () => tracks.filter(({ kind }) => kind === "audio"),
    getVideoTracks: () => tracks.filter(({ kind }) => kind === "video"),
  } as unknown as MediaStream;
}

const SELF = { userId: "wanjiku", name: "Wanjiku Mwangi" };
const CHOICE: MediaChoice = { microphoneId: null, cameraId: null, microphoneOn: true, cameraOn: true, audioOnly: false };
const live = (people: FakePresence["people"], change: Partial<FakePresence> = {}): FakePresence =>
  ({ state: "LIVE", you: "HELD", recording: "recording", people, ...change });

function setup({ presence = [live([SELF, { userId: "kevin", name: "Kevin Omondi" }])], display = true, refuse = new Set<string>() } = {}) {
  const opened: Track[] = [];
  const answers = [...presence];
  const media = {
    getUserMedia: vi.fn(async (constraints: MediaStreamConstraints) => {
      const kind = constraints.video ? "video" : "audio";
      if (refuse.has(kind)) throw new DOMException("Blocked", "NotAllowedError");
      const made = track(kind);
      opened.push(made);
      return stream([made]);
    }),
    ...(display ? {
      getDisplayMedia: vi.fn(async () => {
        const made = track("video");
        opened.push(made);
        return stream([made]);
      }),
    } : {}),
  };
  const read = vi.fn(async () => answers.length > 1 ? answers.shift()! : answers[0]!);
  const levels = { level: vi.fn(() => 0), close: vi.fn() };
  const client = new FakeRoomClient({ meetingId: "m", media, presence: read, meter: () => levels });
  const notices: RoomNotice[] = [];
  client.onNotice((notice) => notices.push(notice));
  return { client, media, opened, read, levels, notices, answers };
}

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe("the fake room client", () => {
  it("joins with the person's real tracks and everyone holding a seat, and polls who is in", async () => {
    const { client, media, read } = setup();
    await client.join({ token: "fake.token", self: SELF, media: CHOICE });
    const state = client.getState();
    expect(state.connection).toBe("connected");
    expect(state.recording).toBe("recording");
    expect(state.participants.map(({ userId, self }) => ({ userId, self }))).toEqual([{ userId: "wanjiku", self: true }, { userId: "kevin", self: false }]);
    expect(state.participants[0]).toMatchObject({ microphoneOn: true, cameraOn: true, sharing: false });
    expect(state.participants[1]).toMatchObject({ microphoneOn: true, cameraOn: false, video: null });
    expect(media.getUserMedia).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(FAKE_PRESENCE_INTERVAL_MS);
    expect(read).toHaveBeenCalledTimes(2);
    await client.leave();
  });

  it("opens no camera for low data, and none for a camera left off", async () => {
    const lowData = setup();
    await lowData.client.join({ token: "t", self: SELF, media: { ...CHOICE, audioOnly: true } });
    expect(lowData.media.getUserMedia).toHaveBeenCalledOnce();
    await lowData.client.setCamera(true);
    expect(lowData.client.getState().participants[0]!.cameraOn).toBe(false);
    await lowData.client.leave();
    const muted = setup();
    await muted.client.join({ token: "t", self: SELF, media: { ...CHOICE, microphoneOn: false, cameraOn: false } });
    expect(muted.media.getUserMedia).not.toHaveBeenCalled();
    expect(muted.client.getState().participants[0]).toMatchObject({ microphoneOn: false, cameraOn: false });
    await muted.client.leave();
  });

  it("joins without a device the browser refuses, as a real client would", async () => {
    const { client } = setup({ refuse: new Set(["video"]) });
    await client.join({ token: "t", self: SELF, media: CHOICE });
    expect(client.getState().participants[0]).toMatchObject({ microphoneOn: true, cameraOn: false });
    await client.leave();
  });

  it("releases every track, timer and listener on leave, and leaving twice is safe", async () => {
    const { client, opened, levels, read } = setup();
    const listener = vi.fn();
    client.subscribe(listener);
    await client.join({ token: "t", self: SELF, media: CHOICE });
    await client.startScreenShare();
    expect(opened).toHaveLength(3);
    await client.leave();
    expect(opened.every(({ stopped }) => stopped)).toBe(true);
    expect(levels.close).toHaveBeenCalledOnce();
    expect(client.released).toBe(true);
    expect(client.getState()).toMatchObject({ connection: "disconnected", participants: [] });
    listener.mockClear();
    await vi.advanceTimersByTimeAsync(FAKE_PRESENCE_INTERVAL_MS * 3);
    expect(read).toHaveBeenCalledOnce();
    expect(listener).not.toHaveBeenCalled();
    await expect(client.leave()).resolves.toBeUndefined();
    await expect(client.join({ token: "t", self: SELF, media: CHOICE })).rejects.toThrow("has left");
  });

  it("releases what it opened when the start fails: a seat that isn't held", async () => {
    const { client, opened } = setup({ presence: [live([], { you: null })] });
    await expect(client.join({ token: "t", self: SELF, media: CHOICE })).rejects.toThrow("isn't held");
    expect(opened).toHaveLength(2);
    expect(opened.every(({ stopped }) => stopped)).toBe(true);
    expect(client.released).toBe(true);
  });

  it("turns the camera off by releasing it, and the microphone by muting it", async () => {
    const { client, opened } = setup();
    await client.join({ token: "t", self: SELF, media: CHOICE });
    const [microphone, camera] = opened;
    await client.setCamera(false);
    expect(camera!.stopped).toBe(true);
    await client.setMicrophone(false);
    expect(microphone!.enabled).toBe(false);
    expect(client.getState().participants[0]).toMatchObject({ microphoneOn: false, cameraOn: false });
    await client.setCamera(true);
    expect(client.getState().participants[0]!.cameraOn).toBe(true);
    await client.leave();
  });

  it("opens each device once however fast it is pressed, so no second track leaks", async () => {
    const { client, media, opened, levels } = setup();
    await client.join({ token: "t", self: SELF, media: { ...CHOICE, microphoneOn: false, cameraOn: false } });
    await Promise.all([client.setCamera(true), client.setCamera(true), client.setMicrophone(true), client.setMicrophone(true)]);
    expect(media.getUserMedia).toHaveBeenCalledTimes(2);
    await Promise.all([client.startScreenShare(), client.startScreenShare()]);
    expect(media.getDisplayMedia).toHaveBeenCalledOnce();
    await client.startScreenShare();
    expect(media.getDisplayMedia).toHaveBeenCalledOnce();
    expect(opened).toHaveLength(3);
    await client.leave();
    expect(opened.every(({ stopped }) => stopped)).toBe(true);
    expect(levels.close).toHaveBeenCalledOnce();
  });

  it("ends off when on and off are pressed quickly, and releases a device that opens after leaving", async () => {
    const { client, media, opened } = setup();
    await client.join({ token: "t", self: SELF, media: { ...CHOICE, microphoneOn: false, cameraOn: false } });
    await Promise.all([client.setCamera(true), client.setCamera(false)]);
    expect(client.getState().participants[0]!.cameraOn).toBe(false);
    expect(opened[0]!.stopped).toBe(true);
    let open!: () => void;
    media.getUserMedia.mockImplementationOnce(async () => {
      await new Promise<void>((resolve) => { open = resolve; });
      const late = track("audio");
      opened.push(late);
      return stream([late]);
    });
    const opening = client.setMicrophone(true);
    await vi.advanceTimersByTimeAsync(0);
    await client.leave();
    open();
    await opening;
    expect(opened.at(-1)!.stopped).toBe(true);
    expect(client.released).toBe(true);
  });

  it("tells the room what the server says: removed, ended, joined somewhere else", async () => {
    const removed = setup({ presence: [live([SELF]), live([], { you: "REMOVED" })] });
    await removed.client.join({ token: "t", self: SELF, media: CHOICE });
    await vi.advanceTimersByTimeAsync(FAKE_PRESENCE_INTERVAL_MS);
    expect(removed.notices).toEqual(["removed"]);
    await removed.client.leave();

    const ended = setup({ presence: [live([SELF]), { state: "ENDED", you: null, recording: "off", people: [] }] });
    await ended.client.join({ token: "t", self: SELF, media: CHOICE });
    await vi.advanceTimersByTimeAsync(FAKE_PRESENCE_INTERVAL_MS);
    expect(ended.notices).toEqual(["ended"]);
    await ended.client.leave();

    const replaced = setup({ presence: [live([SELF]), live([], { you: "RELEASED" })] });
    await replaced.client.join({ token: "t", self: SELF, media: CHOICE });
    await vi.advanceTimersByTimeAsync(FAKE_PRESENCE_INTERVAL_MS);
    expect(replaced.notices).toEqual(["replaced"]);
    await replaced.client.leave();
  });

  it("drops to reconnecting when a read fails, and comes back with the next", async () => {
    const { client, read } = setup({ presence: [live([SELF])] });
    await client.join({ token: "t", self: SELF, media: CHOICE });
    read.mockRejectedValueOnce(new Error("offline"));
    await vi.advanceTimersByTimeAsync(FAKE_PRESENCE_INTERVAL_MS);
    expect(client.getState().connection).toBe("reconnecting");
    await vi.advanceTimersByTimeAsync(FAKE_PRESENCE_INTERVAL_MS);
    expect(client.getState().connection).toBe("connected");
    await client.leave();
  });

  it("shares one screen at a time, says when it can't, and stops when the browser's own bar does", async () => {
    const { client, opened } = setup();
    await client.join({ token: "t", self: SELF, media: CHOICE });
    client.simulateParticipant("kevin", { sharing: true });
    await expect(client.startScreenShare()).rejects.toMatchObject({ reason: "taken", message: "Kevin Omondi is sharing." });
    client.simulateParticipant("kevin", { sharing: false });
    await client.startScreenShare();
    expect(client.getState().participants[0]!.sharing).toBe(true);
    opened.at(-1)!.end();
    expect(client.getState().participants[0]!.sharing).toBe(false);
    await client.leave();

    const phone = setup({ display: false });
    expect(phone.client.canShareScreen).toBe(false);
    await phone.client.join({ token: "t", self: SELF, media: CHOICE });
    await expect(phone.client.startScreenShare()).rejects.toBeInstanceOf(ScreenShareError);
    await expect(phone.client.startScreenShare()).rejects.toMatchObject({ reason: "unsupported" });
    await phone.client.leave();
  });

  it("tells a cancelled share picker from a refusal", async () => {
    const { client, media } = setup();
    await client.join({ token: "t", self: SELF, media: CHOICE });
    media.getDisplayMedia!.mockRejectedValueOnce(new DOMException("No", "NotAllowedError"));
    await expect(client.startScreenShare()).rejects.toMatchObject({ reason: "cancelled" });
    media.getDisplayMedia!.mockRejectedValueOnce(new DOMException("No", "NotReadableError"));
    await expect(client.startScreenShare()).rejects.toMatchObject({ reason: "refused" });
    await client.leave();
  });

  it("lets a host mute someone or stop their share, here", async () => {
    const { client } = setup();
    await client.join({ token: "t", self: SELF, media: CHOICE });
    client.simulateParticipant("kevin", { sharing: true, speaking: true });
    await client.muteParticipant("kevin");
    await client.stopParticipantShare("kevin");
    expect(client.getState().participants[1]).toMatchObject({ microphoneOn: false, speaking: false, sharing: false });
    await client.leave();
  });

  it("simulates what only a provider causes, and polling doesn't undo it", async () => {
    const { client, notices } = setup({ presence: [live([SELF])] });
    await client.join({ token: "t", self: SELF, media: CHOICE });
    client.simulateConnection("reconnecting");
    client.simulateRecording("failed");
    await vi.advanceTimersByTimeAsync(FAKE_PRESENCE_INTERVAL_MS);
    expect(client.getState()).toMatchObject({ connection: "reconnecting", recording: "failed" });
    client.simulateNotice("muted-by-host");
    expect(notices).toEqual(["muted-by-host"]);
    await vi.advanceTimersByTimeAsync(0);
    expect(client.getState().participants[0]!.microphoneOn).toBe(false);
    await client.leave();
  });

  it("says this person is speaking from their microphone's level", async () => {
    const { client, levels } = setup({ presence: [live([SELF])] });
    await client.join({ token: "t", self: SELF, media: CHOICE });
    levels.level.mockReturnValue(0.5);
    await vi.advanceTimersByTimeAsync(300);
    expect(client.getState().participants[0]!.speaking).toBe(true);
    levels.level.mockReturnValue(0);
    await vi.advanceTimersByTimeAsync(300);
    expect(client.getState().participants[0]!.speaking).toBe(false);
    await client.leave();
  });
});
