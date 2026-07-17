import { describe, expect, it } from "vitest";
import { parseFfmpegResult } from "@/lib/recordings/ffmpeg-contract";

describe("parseFfmpegResult", () => {
  it("accepts a complete processing result", () => {
    expect(
      parseFfmpegResult({
        r2VideoKey: "recordings/video.mp4",
        r2AudioKey: "recordings/audio.mp3",
        durationSeconds: 42.5,
        fileSizeBytes: 1024,
      })
    ).toEqual({
      r2VideoKey: "recordings/video.mp4",
      r2AudioKey: "recordings/audio.mp3",
      durationSeconds: 42.5,
      fileSizeBytes: 1024,
    });
  });

  it.each([
    { r2VideoKey: "video.mp4" },
    { r2VideoKey: "video.mp4", r2AudioKey: "" },
    {
      r2VideoKey: "video.mp4",
      r2AudioKey: "audio.mp3",
      durationSeconds: -1,
    },
    {
      r2VideoKey: "video.mp4",
      r2AudioKey: "audio.mp3",
      unexpected: true,
    },
  ])("rejects malformed or expanded container output", (value) => {
    expect(() => parseFfmpegResult(value)).toThrow("invalid processing result");
  });
});
