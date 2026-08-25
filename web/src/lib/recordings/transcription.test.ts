import { describe, expect, it, vi } from "vitest";
import {
  transcribeAudioChunks,
  type TranscriptionAudioChunk,
} from "./transcription";

function createEnvironment(results: unknown[]) {
  const run = vi.fn(
    async (
      _model: string,
      _input: { audio: { body: Uint8Array; contentType: string } }
    ) => results.shift()
  );
  return {
    env: { AI: { run } } as unknown as Env,
    run,
  };
}

const firstChunk: TranscriptionAudioChunk = {
  chunkIndex: 0,
  r2AudioKey: "recordings/recording1/transcription/chunk-00000.mp3",
  offsetSeconds: 0,
  durationSeconds: 120,
};
const secondChunk: TranscriptionAudioChunk = {
  chunkIndex: 1,
  r2AudioKey: "recordings/recording1/transcription/chunk-00001.mp3",
  offsetSeconds: 120,
  durationSeconds: 35,
};
const chunks = [firstChunk, secondChunk];

describe("transcribeAudioChunks", () => {
  it("sends each complete audio file to Whisper without byte slicing", async () => {
    const { env, run } = createEnvironment([
      { text: "first chunk" },
      { text: "second chunk" },
    ]);
    const audioByKey = new Map([
      [firstChunk.r2AudioKey, new Uint8Array([0x49, 0x44, 0x33, 0x01]).buffer],
      [
        secondChunk.r2AudioKey,
        new Uint8Array([0x49, 0x44, 0x33, 0x02, 0x03, 0x04]).buffer,
      ],
    ]);
    const loadAudio = vi.fn(async (chunk: TranscriptionAudioChunk) => ({
      audio: audioByKey.get(chunk.r2AudioKey)!,
      contentType: "audio/mpeg",
    }));

    const transcript = await transcribeAudioChunks({
      env,
      chunks,
      loadAudio,
    });

    expect(loadAudio).toHaveBeenNthCalledWith(1, firstChunk);
    expect(loadAudio).toHaveBeenNthCalledWith(2, secondChunk);
    expect(run).toHaveBeenCalledTimes(2);
    expect(Array.from(run.mock.calls[0]![1].audio.body)).toEqual([
      0x49, 0x44, 0x33, 0x01,
    ]);
    expect(Array.from(run.mock.calls[1]![1].audio.body)).toEqual([
      0x49, 0x44, 0x33, 0x02, 0x03, 0x04,
    ]);
    expect(run.mock.calls[0]![1].audio.contentType).toBe("audio/mpeg");
    expect(transcript.text).toBe("first chunk second chunk");
    expect(transcript.segments.map((segment) => segment.chunkIndex)).toEqual([
      0, 1,
    ]);
    expect(transcript.segments.map((segment) => segment.startTime)).toEqual([
      0, 120,
    ]);
    expect(transcript.segments.map((segment) => segment.endTime)).toEqual([
      120, 155,
    ]);
  });

  it("reports each completed chunk for checkpointing with global timestamps", async () => {
    const { env } = createEnvironment([
      {
        segments: [
          { start: 0, end: 1, text: "hello" },
          { start: 1, end: 2, text: "world" },
        ],
      },
      { text: "fallback text" },
    ]);
    const onChunk = vi.fn();

    const transcript = await transcribeAudioChunks({
      env,
      chunks,
      loadAudio: async () => ({ audio: new Uint8Array(8).buffer }),
      onChunk,
    });

    expect(onChunk).toHaveBeenCalledTimes(2);
    expect(onChunk).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        chunkIndex: 0,
        r2AudioKey:
          "recordings/recording1/transcription/chunk-00000.mp3",
        offsetSeconds: 0,
        durationSeconds: 120,
        audioBytes: 8,
        text: "hello world",
      })
    );
    expect(onChunk).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        chunkIndex: 1,
        r2AudioKey:
          "recordings/recording1/transcription/chunk-00001.mp3",
        offsetSeconds: 120,
        durationSeconds: 35,
        audioBytes: 8,
        text: "fallback text",
      })
    );
    expect(transcript.segments).toHaveLength(3);
    expect(transcript.segments.at(-1)).toMatchObject({
      startTime: 120,
      endTime: 155,
    });
    expect(transcript.vtt).toContain("WEBVTT");
    expect(transcript.vtt).toContain("fallback text");
  });

  it("rejects empty chunk objects before calling Whisper", async () => {
    const { env, run } = createEnvironment([]);

    await expect(
      transcribeAudioChunks({
        env,
        chunks: [firstChunk],
        loadAudio: async () => ({ audio: new ArrayBuffer(0) }),
      })
    ).rejects.toThrow(
      "Audio chunk recordings/recording1/transcription/chunk-00000.mp3 is empty"
    );
    expect(run).not.toHaveBeenCalled();
  });
});
