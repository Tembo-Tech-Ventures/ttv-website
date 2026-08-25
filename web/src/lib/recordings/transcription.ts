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

export interface TranscriptionAudioChunk {
  chunkIndex: number;
  r2AudioKey: string;
  offsetSeconds: number;
  durationSeconds: number;
}

export interface TranscriptionChunkResult {
  chunkIndex: number;
  r2AudioKey: string;
  offsetSeconds: number;
  durationSeconds: number;
  audioBytes: number;
  segments: TranscriptSegment[];
  text: string;
}

export async function transcribeAudioChunks({
  env,
  chunks,
  loadAudio,
  onChunk,
}: {
  env: Env;
  chunks: TranscriptionAudioChunk[];
  loadAudio: (
    chunk: TranscriptionAudioChunk
  ) => Promise<{ audio: ArrayBuffer; contentType?: string }>;
  onChunk?: (chunk: TranscriptionChunkResult) => Promise<void>;
}) {
  if (chunks.length === 0) {
    throw new Error("At least one valid audio chunk is required");
  }

  const segments: TranscriptSegment[] = [];
  for (const chunk of chunks) {
    const loaded = await loadAudio(chunk);
    if (loaded.audio.byteLength === 0) {
      throw new Error(`Audio chunk ${chunk.r2AudioKey} is empty`);
    }

    const result = await runWhisper(env, loaded.audio);
    const chunkSegments = parseWhisperSegments({
      result,
      chunkIndex: chunk.chunkIndex,
      offsetSeconds: chunk.offsetSeconds,
      fallbackEndSeconds: chunk.offsetSeconds + chunk.durationSeconds,
    });

    segments.push(...chunkSegments);
    await onChunk?.({
      chunkIndex: chunk.chunkIndex,
      r2AudioKey: chunk.r2AudioKey,
      offsetSeconds: chunk.offsetSeconds,
      durationSeconds: chunk.durationSeconds,
      audioBytes: loaded.audio.byteLength,
      segments: chunkSegments,
      text: chunkSegments.map((segment) => segment.text).join(" "),
    });
  }

  return {
    text: segments.map((segment) => segment.text).join(" "),
    vtt: segmentsToVtt(segments),
    segments,
  };
}

async function runWhisper(
  env: Env,
  audio: ArrayBuffer
) {
  return (await env.AI.run("@cf/openai/whisper-large-v3-turbo", {
    audio: arrayBufferToBase64(audio),
    word_timestamps: true,
    vad_filter: true,
  })) as {
    text?: string;
    vtt?: string | { segments?: WhisperSegment[] };
    segments?: WhisperSegment[];
  };
}

function arrayBufferToBase64(audio: ArrayBuffer) {
  let binary = "";
  for (const byte of new Uint8Array(audio)) {
    binary += String.fromCharCode(byte);
  }
  return btoa(binary);
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
