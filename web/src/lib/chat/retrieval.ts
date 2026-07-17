import { inArray } from "drizzle-orm";
import type { Database } from "@/lib/db/database";
import * as schema from "@/lib/db/schema";
import type { TranscriptSource } from "@/lib/chat/prompt";
import type { RetrievalStatus } from "@/lib/chat/types";
import { getAccessibleProgramIds } from "@/lib/recordings/access";

interface EmbeddingResult {
  data?: number[][];
  result?: { data?: number[][] };
}

interface TranscriptSegmentWithRecording {
  id: string;
  recordingId: string;
  startTime: number;
  endTime: number;
  text: string;
  recording: { title: string };
}

export interface TranscriptRetrievalResult {
  sources: TranscriptSource[];
  status: RetrievalStatus;
}

export function orderTranscriptSources(
  segmentIds: string[],
  segments: TranscriptSegmentWithRecording[]
): TranscriptSource[] {
  const segmentById = new Map(segments.map((segment) => [segment.id, segment]));

  return segmentIds.flatMap((id) => {
    const segment = segmentById.get(id);
    if (!segment) return [];
    return [
      {
        citation: {
          recordingId: segment.recordingId,
          title: segment.recording.title,
          startTime: segment.startTime,
          endTime: segment.endTime,
          text:
            segment.text.length > 180
              ? `${segment.text.slice(0, 180).trim()}…`
              : segment.text,
        },
        content: segment.text,
      },
    ];
  });
}

export async function retrieveTranscriptSources(input: {
  db: Database;
  ai: Ai;
  vectorize: VectorizeIndex;
  userId: string;
  isAdmin: boolean;
  question: string;
}): Promise<TranscriptRetrievalResult> {
  const programIds = input.isAdmin
    ? []
    : await getAccessibleProgramIds(input.db, input.userId);
  if (!input.isAdmin && programIds.length === 0) {
    return { sources: [], status: "general" };
  }

  const embedding = (await input.ai.run("@cf/baai/bge-m3", {
    text: [input.question],
  })) as EmbeddingResult;
  const vector = embedding.data?.[0] ?? embedding.result?.data?.[0];
  if (!Array.isArray(vector)) {
    throw new Error("Transcript retrieval could not embed the question.");
  }

  const results = await input.vectorize.query(vector, {
    topK: 8,
    returnMetadata: "all",
    ...(input.isAdmin ? {} : { filter: { program_id: { $in: programIds } } }),
  });
  const segmentIds = [
    ...new Set(
      results.matches
        .map((match) => match.metadata?.segment_id)
        .filter((id): id is string => typeof id === "string")
    ),
  ];
  if (segmentIds.length === 0) return { sources: [], status: "general" };

  const segments = await input.db.query.transcriptSegment.findMany({
    where: inArray(schema.transcriptSegment.id, segmentIds),
    with: { recording: { columns: { title: true } } },
  });
  const sources = orderTranscriptSources(segmentIds, segments);
  return { sources, status: sources.length > 0 ? "grounded" : "general" };
}
