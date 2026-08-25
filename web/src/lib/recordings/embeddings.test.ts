import { describe, expect, it, vi } from "vitest";
import {
  buildVectorId,
  chunkTranscriptSegments,
  embedAndIndexRecording,
} from "@/lib/recordings/embeddings";
import * as schema from "@/lib/db/schema";
import type { Database } from "@/lib/db/schema";

function segment(id: string, text: string, startTime: number, endTime: number) {
  return { id, text, startTime, endTime };
}

describe("chunkTranscriptSegments", () => {
  it("records every segment merged into a chunk", () => {
    const chunks = chunkTranscriptSegments(
      [
        segment("a", "one two three", 0, 1),
        segment("b", "four five six", 1, 2),
        segment("c", "seven eight nine", 2, 3),
      ],
      9
    );

    expect(chunks).toHaveLength(1);
    expect(chunks[0].segmentIds).toEqual(["a", "b", "c"]);
    expect(chunks[0].text).toBe("one two three four five six seven eight nine");
    expect(chunks[0].startTime).toBe(0);
    expect(chunks[0].endTime).toBe(3);
  });

  it("starts a new chunk once the word budget is exceeded", () => {
    const chunks = chunkTranscriptSegments(
      [
        segment("a", "one two three", 0, 1),
        segment("b", "four five six", 1, 2),
        segment("c", "seven eight nine", 2, 3),
      ],
      4
    );

    expect(chunks.map((chunk) => chunk.segmentIds)).toEqual([
      ["a"],
      ["b"],
      ["c"],
    ]);
    expect(chunks.map((chunk) => chunk.chunkIndex)).toEqual([0, 1, 2]);
  });

  it("keeps the first segment id as the chunk id for citation metadata", () => {
    const chunks = chunkTranscriptSegments(
      [segment("a", "one two", 0, 1), segment("b", "three four", 1, 2)],
      10
    );

    expect(chunks[0].id).toBe("a");
    expect(chunks[0].segmentIds).toEqual(["a", "b"]);
  });

  it("returns no chunks for an empty transcript", () => {
    expect(chunkTranscriptSegments([])).toEqual([]);
  });
});

describe("buildVectorId", () => {
  it("derives a stable id so re-indexing overwrites in place", () => {
    expect(buildVectorId("rec-1", 0)).toBe("rec-1:0");
    expect(buildVectorId("rec-1", 12)).toBe("rec-1:12");
  });
});

describe("embedAndIndexRecording", () => {
  const recording = {
    id: "rec-1",
    programId: "prog-1",
    title: "Mentor Hours",
  } as typeof schema.recording.$inferSelect;

  function createHarness(
    segments: Array<ReturnType<typeof segment>>,
    aiResponse: unknown = { data: [[0.1, 0.2]] }
  ) {
    const updates: Array<{ vectorId: string; ids: unknown }> = [];
    const where = vi.fn((condition: unknown) => {
      updates[updates.length - 1].ids = condition;
      return Promise.resolve();
    });
    const db = {
      query: {
        transcriptSegment: { findMany: vi.fn().mockResolvedValue(segments) },
      },
      update: vi.fn(() => ({
        set: (values: { vectorId: string }) => {
          updates.push({ vectorId: values.vectorId, ids: undefined });
          return { where };
        },
      })),
    } as unknown as Database;

    const upsert = vi.fn().mockResolvedValue({});
    const env = {
      AI: { run: vi.fn().mockResolvedValue(aiResponse) },
      VECTORIZE: { upsert },
    } as unknown as Env;

    return { db, env, upsert, updates };
  }

  it("tags every segment in a chunk with the chunk's vector id", async () => {
    const { db, env, upsert, updates } = createHarness([
      segment("a", "one two", 0, 1),
      segment("b", "three four", 1, 2),
    ]);

    await embedAndIndexRecording({ db, env, recording });

    expect(upsert).toHaveBeenCalledTimes(1);
    expect(updates).toHaveLength(1);
    expect(updates[0].vectorId).toBe("rec-1:0");
    expect(db.update).toHaveBeenCalledWith(schema.transcriptSegment);
  });

  it("upserts chunk metadata used for access filtering and citations", async () => {
    const { env, db, upsert } = createHarness([segment("a", "hello there", 0, 5)]);

    await embedAndIndexRecording({ db, env, recording });

    expect(upsert).toHaveBeenCalledWith([
      {
        id: "rec-1:0",
        values: [0.1, 0.2],
        metadata: {
          segment_id: "a",
          recording_id: "rec-1",
          program_id: "prog-1",
          title: "Mentor Hours",
          start_time: 0,
          end_time: 5,
        },
      },
    ]);
  });

  it("throws when Workers AI returns no vector data", async () => {
    const { db, env } = createHarness([segment("a", "hello", 0, 1)], {});

    await expect(embedAndIndexRecording({ db, env, recording })).rejects.toThrow(
      "Workers AI embedding response did not include vector data"
    );
  });
});
