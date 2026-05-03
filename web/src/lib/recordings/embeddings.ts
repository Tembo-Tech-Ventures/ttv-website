import { eq } from "drizzle-orm";
import * as schema from "@/lib/db/schema";
import type { Database } from "@/lib/db/schema";

export interface TranscriptChunk {
  id: string;
  text: string;
  startTime: number;
  endTime: number;
  chunkIndex: number;
}

export function chunkTranscriptSegments(
  segments: Array<{ id: string; text: string; startTime: number; endTime: number }>,
  maxWords = 180
) {
  const chunks: TranscriptChunk[] = [];
  let current: TranscriptChunk | null = null;

  for (const segment of segments) {
    const words = segment.text.trim().split(/\s+/).filter(Boolean);
    const currentWords = current?.text.split(/\s+/).filter(Boolean).length ?? 0;

    if (!current || currentWords + words.length > maxWords) {
      current = {
        id: segment.id,
        text: segment.text,
        startTime: segment.startTime,
        endTime: segment.endTime,
        chunkIndex: chunks.length,
      };
      chunks.push(current);
      continue;
    }

    current.text = `${current.text} ${segment.text}`;
    current.endTime = segment.endTime;
  }

  return chunks;
}

export async function embedAndIndexRecording({
  db,
  env,
  recording,
}: {
  db: Database;
  env: Env;
  recording: typeof schema.recording.$inferSelect;
}) {
  const segments = await db.query.transcriptSegment.findMany({
    where: eq(schema.transcriptSegment.recordingId, recording.id),
    orderBy: (segment, { asc }) => [asc(segment.startTime)],
  });

  const chunks = chunkTranscriptSegments(segments);
  for (const chunk of chunks) {
    const embedding = (await env.AI.run("@cf/baai/bge-m3", {
      text: [chunk.text],
    })) as { data?: number[][]; result?: { data?: number[][] } };
    const values = embedding.data?.[0] ?? embedding.result?.data?.[0];
    if (!Array.isArray(values)) {
      throw new Error("Workers AI embedding response did not include vector data");
    }

    const vectorId = `${recording.id}:${chunk.chunkIndex}`;
    await env.VECTORIZE.upsert([
      {
        id: vectorId,
        values,
        metadata: {
          segment_id: chunk.id,
          recording_id: recording.id,
          program_id: recording.programId ?? "",
          title: recording.title,
          start_time: chunk.startTime,
          end_time: chunk.endTime,
        },
      },
    ]);

    await db
      .update(schema.transcriptSegment)
      .set({ vectorId })
      .where(eq(schema.transcriptSegment.id, chunk.id));
  }
}
