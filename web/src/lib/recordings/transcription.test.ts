import { describe, expect, it, vi } from "vitest";
import { transcribeAudioObject } from "@/lib/recordings/transcription";

interface WhisperRunInput {
  audio: {
    body: Uint8Array;
    contentType: string;
  };
  vad_filter: boolean;
}

describe("transcribeAudioObject", () => {
  it("uses the supported Cloudflare Whisper contract and preserves segments", async () => {
    const run = vi.fn().mockResolvedValue({
      text: "Hello world",
      segments: [{ start: 1, end: 2.5, text: " Hello world " }],
    });
    const env = { AI: { run } } as unknown as Env;

    const result = await transcribeAudioObject({
      env,
      audio: new Uint8Array([1, 2, 3]).buffer,
    });

    const [model, input] = run.mock.calls[0] as
      [string, WhisperRunInput] | [undefined, undefined];
    expect(model).toBe("@cf/openai/whisper-large-v3-turbo");
    expect(input).toMatchObject({
      audio: { contentType: "audio/mpeg" },
      vad_filter: true,
    });
    expect(input?.audio.body).toBeInstanceOf(Uint8Array);
    expect(result.text).toBe("Hello world");
    expect(result.segments).toEqual([
      expect.objectContaining({ startTime: 1, endTime: 2.5, text: "Hello world" }),
    ]);
  });

  it("creates a fallback segment when Whisper only returns text", async () => {
    const env = {
      AI: { run: vi.fn().mockResolvedValue({ text: "Fallback transcript" }) },
    } as unknown as Env;

    const result = await transcribeAudioObject({ env, audio: new ArrayBuffer(0) });

    expect(result.segments).toEqual([
      expect.objectContaining({
        startTime: 0,
        endTime: 1,
        text: "Fallback transcript",
      }),
    ]);
  });
});
