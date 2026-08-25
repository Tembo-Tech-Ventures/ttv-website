import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  drizzle: vi.fn(),
  getAccessibleProgramIds: vi.fn(),
  generateChatCompletion: vi.fn(),
  aiRun: vi.fn(),
  vectorizeQuery: vi.fn(),
}));

vi.mock("cloudflare:workers", () => ({
  env: {
    DB: {},
    AI: { run: mocks.aiRun },
    VECTORIZE: { query: mocks.vectorizeQuery },
  },
}));
vi.mock("drizzle-orm/d1", () => ({ drizzle: mocks.drizzle }));
vi.mock("@/lib/recordings/access", () => ({
  getAccessibleProgramIds: mocks.getAccessibleProgramIds,
}));
vi.mock("@/lib/ai/gateway", () => ({
  generateChatCompletion: mocks.generateChatCompletion,
}));

import { POST } from "./chat";

interface TestSegment {
  id: string;
  recordingId: string;
  vectorId: string;
  startTime: number;
  endTime: number;
  text: string;
  recording: { title: string };
}

function createDatabase(segments: TestSegment[]) {
  const inserted: unknown[] = [];
  return {
    inserted,
    database: {
      query: {
        transcriptSegment: {
          findMany: vi.fn(async (_args: { with?: unknown }) =>
            segments.toSorted((a, b) => a.startTime - b.startTime)
          ),
        },
      },
      insert: vi.fn(() => ({
        values: vi.fn(async (values: unknown) => {
          inserted.push(values);
        }),
      })),
    },
  };
}

function context({
  user = { id: "user-1" },
  isAdmin = false,
  body = { message: "what is ollama?" },
}: {
  user?: { id: string } | null;
  isAdmin?: boolean;
  body?: unknown;
} = {}) {
  return {
    request: new Request("https://example.com/api/chat", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    }),
    locals: { user, isAdmin },
  } as never;
}

function segment(
  vectorId: string,
  id: string,
  text: string,
  startTime: number,
  endTime: number
): TestSegment {
  return {
    id,
    recordingId: "rec-1",
    vectorId,
    startTime,
    endTime,
    text,
    recording: { title: "Mentor Hours" },
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.getAccessibleProgramIds.mockResolvedValue(["prog-1"]);
  mocks.aiRun.mockResolvedValue({ data: [[0.1, 0.2]] });
  mocks.generateChatCompletion.mockResolvedValue("Ollama is a model runner.");
});

describe("POST /api/chat", () => {
  it("rejects an unauthenticated request", async () => {
    const response = await POST(context({ user: null }));
    expect(response.status).toBe(401);
  });

  it("requires a message", async () => {
    const response = await POST(context({ body: {} }));
    expect(response.status).toBe(400);
  });

  it("rejects an over-long message before spending an embedding call", async () => {
    const response = await POST(
      context({ body: { message: "a".repeat(2001) } })
    );
    expect(response.status).toBe(400);
    expect(mocks.aiRun).not.toHaveBeenCalled();
  });

  it("filters the vector search to the programs the user can access", async () => {
    mocks.getAccessibleProgramIds.mockResolvedValue(["prog-1", "prog-2"]);
    mocks.vectorizeQuery.mockResolvedValue({ matches: [] });
    mocks.drizzle.mockReturnValue(createDatabase([]).database);

    await POST(context());

    expect(mocks.vectorizeQuery).toHaveBeenCalledWith(
      [0.1, 0.2],
      expect.objectContaining({
        filter: { program_id: { $in: ["prog-1", "prog-2"] } },
      })
    );
  });

  it("does not filter by program for an admin", async () => {
    mocks.vectorizeQuery.mockResolvedValue({ matches: [] });
    mocks.drizzle.mockReturnValue(createDatabase([]).database);

    await POST(context({ isAdmin: true }));

    expect(mocks.vectorizeQuery).toHaveBeenCalledWith(
      [0.1, 0.2],
      expect.objectContaining({ filter: undefined })
    );
  });

  it("rebuilds the full embedded chunk from every segment sharing a vector id", async () => {
    mocks.vectorizeQuery.mockResolvedValue({
      matches: [{ id: "rec-1:0" }],
    });
    const { database } = createDatabase([
      segment("rec-1:0", "seg-b", "so you can run models with it", 15, 25),
      segment("rec-1:0", "seg-a", "ollama is a model runner", 5, 15),
    ]);
    mocks.drizzle.mockReturnValue(database);

    const response = await POST(context());

    expect(response.status).toBe(200);
    const system = mocks.generateChatCompletion.mock.calls[0][1][0].content;
    expect(system).toContain(
      "ollama is a model runner so you can run models with it"
    );

    const payload = (await response.json()) as {
      citations: Array<{ startTime: number; endTime: number; text: string }>;
    };
    expect(payload.citations).toHaveLength(1);
    expect(payload.citations[0]).toMatchObject({
      recordingId: "rec-1",
      title: "Mentor Hours",
      startTime: 5,
      endTime: 25,
      text: "ollama is a model runner so you can run models with it",
    });
  });

  it("looks segments up by vector id rather than by a single segment id", async () => {
    mocks.vectorizeQuery.mockResolvedValue({
      matches: [{ id: "rec-1:0" }, { id: "rec-1:1" }],
    });
    const { database } = createDatabase([
      segment("rec-1:0", "seg-a", "first chunk", 0, 10),
      segment("rec-1:1", "seg-b", "second chunk", 10, 20),
    ]);
    mocks.drizzle.mockReturnValue(database);

    await POST(context());

    expect(database.query.transcriptSegment.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ with: { recording: true } })
    );

    const system = mocks.generateChatCompletion.mock.calls[0][1][0].content;
    expect(system).toContain("first chunk");
    expect(system).toContain("second chunk");
  });

  it("tells the user when they have no accessible programs", async () => {
    mocks.getAccessibleProgramIds.mockResolvedValue([]);

    const response = await POST(context());

    await expect(response.json()).resolves.toEqual({
      answer: "No session recordings are available for your account yet.",
      citations: [],
    });
    expect(mocks.vectorizeQuery).not.toHaveBeenCalled();
  });

  it("reports no relevant transcript when the vector search returns nothing", async () => {
    mocks.vectorizeQuery.mockResolvedValue({ matches: [] });
    mocks.drizzle.mockReturnValue(createDatabase([]).database);

    const response = await POST(context());

    await expect(response.json()).resolves.toEqual({
      answer: "I could not find a relevant transcript segment for that question.",
      citations: [],
    });
    expect(mocks.generateChatCompletion).not.toHaveBeenCalled();
  });

  it("reports no relevant transcript when matched vectors have no stored segments", async () => {
    mocks.vectorizeQuery.mockResolvedValue({ matches: [{ id: "rec-1:9" }] });
    mocks.drizzle.mockReturnValue(createDatabase([]).database);

    const response = await POST(context());

    await expect(response.json()).resolves.toEqual({
      answer: "I could not find a relevant transcript segment for that question.",
      citations: [],
    });
    expect(mocks.generateChatCompletion).not.toHaveBeenCalled();
  });

  it("persists the exchange with citations", async () => {
    mocks.vectorizeQuery.mockResolvedValue({ matches: [{ id: "rec-1:0" }] });
    const { database, inserted } = createDatabase([
      segment("rec-1:0", "seg-a", "ollama is a model runner", 5, 15),
    ]);
    mocks.drizzle.mockReturnValue(database);

    await POST(context());

    expect(inserted).toHaveLength(1);
    const rows = inserted[0] as Array<{ role: string; content: string }>;
    expect(rows.map((row) => row.role)).toEqual(["user", "assistant"]);
    expect(rows[0].content).toBe("what is ollama?");
    expect(rows[1].content).toBe("Ollama is a model runner.");
  });

  it("fails cleanly when the embedding model returns no vector", async () => {
    mocks.aiRun.mockResolvedValue({});

    const response = await POST(context());

    expect(response.status).toBe(500);
    expect(mocks.vectorizeQuery).not.toHaveBeenCalled();
  });
});
