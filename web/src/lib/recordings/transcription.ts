import { createId } from "@paralleldrive/cuid2";
import { segmentsToVtt } from "@/lib/recordings/time-utils";

interface WhisperSegment {
  start?: number;
  end?: number;
  text?: string;
}

export interface TranscriptSegment {
  id: string;
  startTime: number;
  endTime: number;
  text: string;
  chunkIndex: number;
}

export interface TranscriptionChunkResult {
  chunkIndex: number;
  byteStart: number;
  byteEnd: number;
  offsetSeconds: number;
  segments: TranscriptSegment[];
  text: string;
}

const DEFAULT_AUDIO_CHUNK_BYTES = 1024 * 1024;

export async function transcribeAudioObject({
  env,
  audio,
  durationSeconds,
  chunkBytes = DEFAULT_AUDIO_CHUNK_BYTES,
  onChunk,
}: {
  env: Env;
  audio: ArrayBuffer;
  durationSeconds?: number | null;
  chunkBytes?: number;
  onChunk?: (chunk: TranscriptionChunkResult) => Promise<void>;
}) {
  if (chunkBytes <= 0) {
    throw new Error("Audio chunk size must be greater than zero");
  }

  const segments: TranscriptSegment[] = [];
  const totalBytes = audio.byteLength;
  let chunkIndex = 0;

  for (let byteStart = 0; byteStart < totalBytes; byteStart += chunkBytes) {
    const byteEnd = Math.min(byteStart + chunkBytes, totalBytes);
    const chunk = audio.slice(byteStart, byteEnd);
    const offsetSeconds =
      durationSeconds && totalBytes > 0
        ? (durationSeconds * byteStart) / totalBytes
        : 0;
    const fallbackEndSeconds =
      durationSeconds && totalBytes > 0
        ? (durationSeconds * byteEnd) / totalBytes
        : offsetSeconds + 1;

    const result = await runWhisper(env, chunk);
    const chunkSegments = parseWhisperSegments({
      result,
      chunkIndex,
      offsetSeconds,
      fallbackEndSeconds,
    });

    segments.push(...chunkSegments);
    await onChunk?.({
      chunkIndex,
      byteStart,
      byteEnd,
      offsetSeconds,
      segments: chunkSegments,
      text: chunkSegments.map((segment) => segment.text).join(" "),
    });

    chunkIndex += 1;
  }

  return {
    text: segments.map((segment) => segment.text).join(" "),
    vtt: segmentsToVtt(segments),
    segments,
  };
}

async function runWhisper(env: Env, audio: ArrayBuffer) {
  return (await env.AI.run("@cf/openai/whisper-large-v3-turbo", {
    audio: {
      body: new Uint8Array(audio),
      contentType: "audio/mpeg",
    },
    word_timestamps: true,
    vad_filter: true,
  })) as {
    text?: string;
    vtt?: string | { segments?: WhisperSegment[] };
    segments?: WhisperSegment[];
  };
}

function parseWhisperSegments({
  result,
  chunkIndex,
  offsetSeconds,
  fallbackEndSeconds,
}: {
  result: Awaited<ReturnType<typeof runWhisper>>;
  chunkIndex: number;
  offsetSeconds: number;
  fallbackEndSeconds: number;
}) {
  const vttSegments =
    typeof result.vtt === "object" ? result.vtt.segments : undefined;
  const rawSegments = (result.segments ?? vttSegments ?? []) as WhisperSegment[];
  const segments = rawSegments
    .filter((segment) => segment.text && segment.start !== undefined)
    .map((segment, index) => ({
      id: createId(),
      startTime: offsetSeconds + Number(segment.start ?? index),
      endTime: offsetSeconds + Number(segment.end ?? segment.start ?? index + 1),
      text: String(segment.text).trim(),
      chunkIndex,
    }));

  if (segments.length === 0 && result.text) {
    segments.push({
      id: createId(),
      startTime: offsetSeconds,
      endTime: fallbackEndSeconds,
      text: String(result.text).trim(),
      chunkIndex,
    });
  }

  return segments;
}
