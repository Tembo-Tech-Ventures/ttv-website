import { describe, expect, it, vi } from "vitest";
import { transcribeAudioObject } from "./transcription";

function createEnvironment(results: unknown[]) {
  const run = vi.fn(async () => results.shift());
  return {
    AI: { run },
  } as unknown as Env;
}

describe("transcribeAudioObject", () => {
  it("splits large audio into bounded Whisper requests", async () => {
    const env = createEnvironment([
      { text: "first chunk" },
      { text: "second chunk" },
      { text: "third chunk" },
    ]);
    const audio = new Uint8Array(10).buffer;

    const transcript = await transcribeAudioObject({
      env,
      audio,
      durationSeconds: 100,
      chunkBytes: 4,
    });

    expect(env.AI.run).toHaveBeenCalledTimes(3);
    expect(env.AI.run).toHaveBeenNthCalledWith(
      1,
      "@cf/openai/whisper-large-v3-turbo",
      expect.objectContaining({
        audio: expect.objectContaining({
          body: expect.objectContaining({ byteLength: 4 }),
          contentType: "audio/mpeg",
        }),
      })
    );
    expect(env.AI.run).toHaveBeenNthCalledWith(
      3,
      "@cf/openai/whisper-large-v3-turbo",
      expect.objectContaining({
        audio: expect.objectContaining({
          body: expect.objectContaining({ byteLength: 2 }),
        }),
      })
    );
    expect(transcript.text).toBe("first chunk second chunk third chunk");
    expect(transcript.segments.map((segment) => segment.chunkIndex)).toEqual([
      0, 1, 2,
    ]);
    expect(transcript.segments.map((segment) => segment.startTime)).toEqual([
      0, 40, 80,
    ]);
  });

  it("reports each completed chunk for checkpointing", async () => {
    const env = createEnvironment([
      {
        segments: [
          { start: 0, end: 1, text: "hello" },
          { start: 1, end: 2, text: "world" },
        ],
      },
      { text: "fallback text" },
    ]);
    const onChunk = vi.fn();

    const transcript = await transcribeAudioObject({
      env,
      audio: new Uint8Array(8).buffer,
      durationSeconds: 80,
      chunkBytes: 4,
      onChunk,
    });

    expect(onChunk).toHaveBeenCalledTimes(2);
    expect(onChunk).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        chunkIndex: 0,
        byteStart: 0,
        byteEnd: 4,
        offsetSeconds: 0,
        text: "hello world",
      })
    );
    expect(onChunk).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        chunkIndex: 1,
        byteStart: 4,
        byteEnd: 8,
        offsetSeconds: 40,
        text: "fallback text",
      })
    );
    expect(transcript.segments).toHaveLength(3);
    expect(transcript.vtt).toContain("WEBVTT");
    expect(transcript.vtt).toContain("fallback text");
  });
});
