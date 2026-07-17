import { beforeEach, describe, expect, it, vi } from "vitest";
import { retrieveTranscriptSources } from "@/lib/chat/retrieval";
import { getAccessibleProgramIds } from "@/lib/recordings/access";

vi.mock("@/lib/recordings/access", () => ({
  getAccessibleProgramIds: vi.fn(),
}));

const accessibleProgramIds = vi.mocked(getAccessibleProgramIds);

function createDependencies() {
  const findMany = vi.fn().mockResolvedValue([
    {
      id: "segment-2",
      recordingId: "recording-2",
      startTime: 20,
      endTime: 25,
      text: "Second excerpt",
      recording: { title: "Second session" },
    },
    {
      id: "segment-1",
      recordingId: "recording-1",
      startTime: 5,
      endTime: 10,
      text: "First excerpt",
      recording: { title: "First session" },
    },
  ]);
  const run = vi.fn().mockResolvedValue({ data: [[0.1, 0.2]] });
  const query = vi.fn().mockResolvedValue({
    matches: [
      { metadata: { segment_id: "segment-1" } },
      { metadata: { segment_id: "segment-1" } },
      { metadata: { segment_id: "missing" } },
      { metadata: { segment_id: "segment-2" } },
      { metadata: {} },
    ],
  });

  return {
    input: {
      db: { query: { transcriptSegment: { findMany } } } as never,
      ai: { run } as never,
      vectorize: { query } as never,
      userId: "user-1",
      isAdmin: false,
      question: "What did we learn?",
    },
    findMany,
    query,
    run,
  };
}

beforeEach(() => {
  accessibleProgramIds.mockReset();
});

describe("retrieveTranscriptSources", () => {
  it("skips inference when a learner has no accessible programs", async () => {
    accessibleProgramIds.mockResolvedValue([]);
    const dependencies = createDependencies();

    await expect(retrieveTranscriptSources(dependencies.input)).resolves.toEqual({
      sources: [],
      status: "general",
    });
    expect(dependencies.run).not.toHaveBeenCalled();
    expect(dependencies.query).not.toHaveBeenCalled();
  });

  it("filters by accessible programs, deduplicates matches, and preserves relevance", async () => {
    accessibleProgramIds.mockResolvedValue(["program-1", "program-2"]);
    const dependencies = createDependencies();

    const result = await retrieveTranscriptSources(dependencies.input);

    expect(dependencies.run).toHaveBeenCalledWith("@cf/baai/bge-m3", {
      text: ["What did we learn?"],
    });
    expect(dependencies.query).toHaveBeenCalledWith([0.1, 0.2], {
      topK: 8,
      returnMetadata: "all",
      filter: { program_id: { $in: ["program-1", "program-2"] } },
    });
    expect(result.status).toBe("grounded");
    expect(result.sources.map((source) => source.citation.title)).toEqual([
      "First session",
      "Second session",
    ]);
  });

  it("lets admins search all programs and accepts the nested embedding shape", async () => {
    const dependencies = createDependencies();
    dependencies.input.isAdmin = true;
    dependencies.run.mockResolvedValue({ result: { data: [[0.3, 0.4]] } });

    await retrieveTranscriptSources(dependencies.input);

    expect(accessibleProgramIds).not.toHaveBeenCalled();
    expect(dependencies.query).toHaveBeenCalledWith([0.3, 0.4], {
      topK: 8,
      returnMetadata: "all",
    });
  });

  it("fails explicitly when the embedding response has no vector", async () => {
    accessibleProgramIds.mockResolvedValue(["program-1"]);
    const dependencies = createDependencies();
    dependencies.run.mockResolvedValue({});

    await expect(retrieveTranscriptSources(dependencies.input)).rejects.toThrow(
      "could not embed"
    );
    expect(dependencies.query).not.toHaveBeenCalled();
  });

  it("returns general chat when Vectorize finds no transcript segments", async () => {
    accessibleProgramIds.mockResolvedValue(["program-1"]);
    const dependencies = createDependencies();
    dependencies.query.mockResolvedValue({ matches: [] });

    await expect(retrieveTranscriptSources(dependencies.input)).resolves.toEqual({
      sources: [],
      status: "general",
    });
    expect(dependencies.findMany).not.toHaveBeenCalled();
  });
});
