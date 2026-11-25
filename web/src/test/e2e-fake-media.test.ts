import path from "node:path";
import { describe, expect, it } from "vitest";
import { FAKE_MEDIA_FLAGS, fakeMediaArgs } from "../../e2e/fake-media";

/* The call checks' fake camera and microphone (e2e/fake-media.ts, docs/meetings-testing.md). */
describe("fakeMediaArgs", () => {
  it("gives Chromium a fake camera and microphone, already allowed, with no files named", () => {
    expect(fakeMediaArgs({})).toEqual(["--use-fake-device-for-media-stream", "--use-fake-ui-for-media-stream"]);
    expect(fakeMediaArgs({ CALL_FAKE_VIDEO: "  ", CALL_FAKE_AUDIO: "" })).toEqual([...FAKE_MEDIA_FLAGS]);
  });

  it("plays a named video and sound, by absolute path", () => {
    const args = fakeMediaArgs({ CALL_FAKE_VIDEO: "media/talking.y4m", CALL_FAKE_AUDIO: "/tmp/hello.WAV" }, () => true);
    expect(args).toEqual([
      ...FAKE_MEDIA_FLAGS,
      `--use-file-for-fake-video-capture=${path.resolve("media/talking.y4m")}`,
      "--use-file-for-fake-audio-capture=/tmp/hello.WAV",
    ]);
  });

  it("refuses a file Chromium can't play, or one that isn't there, rather than a silent test pattern", () => {
    expect(() => fakeMediaArgs({ CALL_FAKE_VIDEO: "clip.mp4" }, () => true)).toThrow("CALL_FAKE_VIDEO must be a .y4m or .mjpeg file");
    expect(() => fakeMediaArgs({ CALL_FAKE_AUDIO: "voice.mp3" }, () => true)).toThrow("CALL_FAKE_AUDIO must be a .wav file");
    expect(() => fakeMediaArgs({ CALL_FAKE_AUDIO: "/nowhere/voice.wav" }, () => false)).toThrow("names a file that doesn't exist: /nowhere/voice.wav");
  });
});
