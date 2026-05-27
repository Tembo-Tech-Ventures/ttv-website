import { createId } from "@paralleldrive/cuid2";
import { segmentsToVtt } from "@/lib/recordings/time-utils";

interface WhisperSegment {
  start?: number;
  end?: number;
  text?: string;
}

export async function transcribeAudioObject({
  env,
  audio,
}: {
  env: Env;
  audio: ArrayBuffer;
}) {
  const result = (await env.AI.run("@cf/openai/whisper-large-v3-turbo", {
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

  const vttSegments =
    typeof result.vtt === "object" ? result.vtt.segments : undefined;
  const rawSegments = (result.segments ?? vttSegments ?? []) as WhisperSegment[];
  const segments = rawSegments
    .filter((segment) => segment.text && segment.start !== undefined)
    .map((segment, index) => ({
      id: createId(),
      startTime: Number(segment.start ?? index),
      endTime: Number(segment.end ?? segment.start ?? index + 1),
      text: String(segment.text).trim(),
      chunkIndex: index,
    }));

  if (segments.length === 0 && result.text) {
    segments.push({
      id: createId(),
      startTime: 0,
      endTime: 1,
      text: String(result.text).trim(),
      chunkIndex: 0,
    });
  }

  return {
    text: segments.map((segment) => segment.text).join(" "),
    vtt: typeof result.vtt === "string" ? result.vtt : segmentsToVtt(segments),
    segments,
  };
}
