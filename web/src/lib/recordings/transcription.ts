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
    vad_filter: true,
  })) as {
    text?: string;
    vtt?: string | { segments?: WhisperSegment[] };
    segments?: WhisperSegment[];
  };

  const vttSegments = typeof result.vtt === "object" ? result.vtt.segments : undefined;
  const rawSegments = result.segments ?? vttSegments ?? [];
  const segments = rawSegments.flatMap((segment, index) => {
    const text = segment.text?.trim();
    if (!text || segment.start === undefined) return [];

    return [
      {
        id: createId(),
        startTime: segment.start,
        endTime: segment.end ?? segment.start,
        text,
        chunkIndex: index,
      },
    ];
  });

  if (segments.length === 0 && result.text) {
    segments.push({
      id: createId(),
      startTime: 0,
      endTime: 1,
      text: result.text.trim(),
      chunkIndex: 0,
    });
  }

  return {
    text: segments.map((segment) => segment.text).join(" "),
    vtt: typeof result.vtt === "string" ? result.vtt : segmentsToVtt(segments),
    segments,
  };
}
