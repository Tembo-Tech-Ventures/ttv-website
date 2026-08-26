import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  env: {
    DB: {},
    AI: { run: vi.fn() },
    VECTORIZE: { query: vi.fn() },
  },
  drizzle: vi.fn(),
  getAccessibleProgramIds: vi.fn(),
  generateChatCompletion: vi.fn(),
}));

vi.mock("cloudflare:workers", () => ({ env: mocks.env }));
vi.mock("drizzle-orm/d1", () => ({ drizzle: mocks.drizzle }));
vi.mock("@/lib/recordings/access", () => ({
  getAccessibleProgramIds: mocks.getAccessibleProgramIds,
}));
vi.mock("@/lib/ai/gateway", () => ({
  generateChatCompletion: mocks.generateChatCompletion,
}));

import { POST } from "./chat";

interface ChatResponse {
  sessionId?: string;
  answer: string;
  citations: Array<Record<string, unknown>>;
}

async function json(response: Response) {
  return response.json() as Promise<ChatResponse>;
}

function request(message = "What happened in mentor hours?") {
  return new Request("https://example.com/api/chat", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ message }),
  });
}

function context(overrides: Record<string, unknown> = {}) {
  return {
    request: request(),
    locals: {
      user: { id: "user-1" },
      isAdmin: false,
      ...overrides,
    },
  } as Parameters<typeof POST>[0];
}

function createDatabase(segmentRows: Array<Record<string, unknown>> = []) {
  const values = vi.fn().mockResolvedValue(undefined);
  const insert = vi.fn(() => ({ values }));
  const orderBy = vi.fn().mockResolvedValue(segmentRows);
  const where = vi.fn(() => ({ orderBy }));
  const innerJoin = vi.fn(() => ({ where }));
  const from = vi.fn(() => ({ innerJoin }));
  const select = vi.fn(() => ({ from }));

  return {
    select,
    from,
    innerJoin,
    where,
    orderBy,
    insert,
    values,
  };
}

function createD1Mock() {
  const run = vi.fn().mockResolvedValue({ meta: { changes: 1 } });
  const first = vi.fn().mockResolvedValue(null);
  const all = vi.fn().mockResolvedValue({ results: [] });
  const bind = vi.fn(() => ({ run, first, all }));
  const prepare = vi.fn(() => ({ bind }));

  return { prepare, bind, run, first, all };
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.env.DB = createD1Mock();
  mocks.env.AI.run.mockResolvedValue({ data: [[0.1, 0.2, 0.3]] });
  mocks.env.VECTORIZE.query.mockResolvedValue({
    matches: [
      {
        metadata: {
          segment_id: "segment-1",
          recording_id: "recording-1",
          start_time: 10,
          end_time: 40,
        },
      },
    ],
  });
  mocks.getAccessibleProgramIds.mockResolvedValue(["program-1"]);
  mocks.generateChatCompletion.mockResolvedValue("Use the cited transcript.");
});

describe("POST /api/chat", () => {
  it("returns the no-recordings answer before querying Vectorize when a non-admin has no accessible programs", async () => {
    mocks.getAccessibleProgramIds.mockResolvedValue([]);
    const database = createDatabase();
    mocks.drizzle.mockReturnValue(database);

    const response = await POST(context());
    const body = await json(response);

    expect(body.answer).toBe("No session recordings are available for your account yet.");
    expect(body.citations).toEqual([]);
    expect(body.sessionId).toEqual(expect.any(String));
    expect(mocks.env.VECTORIZE.query).not.toHaveBeenCalled();
    expect(database.values).toHaveBeenCalledWith([
      expect.objectContaining({
        sessionId: body.sessionId,
        role: "user",
      }),
      expect.objectContaining({
        sessionId: body.sessionId,
        role: "assistant",
        citations: "[]",
      }),
    ]);
  });

  it("queries candidate vectors without a metadata filter and builds natural-language context from full transcript chunks", async () => {
    const database = createDatabase([
      {
        id: "segment-1",
        recordingId: "recording-1",
        startTime: 12,
        endTime: 34,
        text: "Mentor hours covered customer discovery.",
        recordingTitle: "Mentor Hours",
        recordingProgramId: "program-1",
      },
      {
        id: "segment-2",
        recordingId: "recording-1",
        startTime: 34,
        endTime: 39,
        text: "Students should interview customers before building.",
        recordingTitle: "Mentor Hours",
        recordingProgramId: "program-1",
      },
    ]);
    mocks.drizzle.mockReturnValue(database);

    const response = await POST(context());
    const body = await json(response);

    expect(response.status).toBe(200);
    expect(mocks.env.VECTORIZE.query).toHaveBeenCalledWith(
      [0.1, 0.2, 0.3],
      expect.objectContaining({
        topK: 50,
        returnMetadata: "all",
      })
    );
    expect(mocks.env.VECTORIZE.query.mock.calls[0][1]).not.toHaveProperty("filter");
    expect(database.select).toHaveBeenCalled();
    expect(mocks.generateChatCompletion).toHaveBeenCalledWith(
      mocks.env,
      expect.arrayContaining([
        expect.objectContaining({
          role: "system",
          content: expect.stringContaining("Mentor hours covered customer discovery."),
        }),
      ]),
      expect.objectContaining({
        maxTokens: 900,
        temperature: 0.2,
      })
    );
    const systemMessage = mocks.generateChatCompletion.mock.calls[0][1][0];
    expect(systemMessage.content).toContain("Synthesize the relevant points");
    expect(systemMessage.content).toContain("[1] Mentor Hours");
    expect(systemMessage.content).toContain(
      "Mentor hours covered customer discovery. Students should interview customers before building."
    );
    expect(mocks.generateChatCompletion.mock.calls[0][2]).toEqual({
      maxTokens: 900,
      temperature: 0.2,
    });
    expect(systemMessage.content).toContain("speech-to-text mistakes");
    expect(systemMessage.content).toContain("clean up those errors");
    expect(body.sessionId).toEqual(expect.any(String));
    expect(body.citations).toEqual([
      {
        sourceNumber: 1,
        recordingId: "recording-1",
        title: "Mentor Hours",
        startTime: 12,
        endTime: 39,
        url: "/dashboard/sessions/recording-1?t=12",
        text: "Mentor hours covered customer discovery. Students should interview customers before building.",
      },
    ]);
  });

  it("does not call the LLM when no accessible transcript rows remain after D1 filtering", async () => {
    mocks.drizzle.mockReturnValue(createDatabase([]));

    const response = await POST(context());
    const body = await json(response);

    expect(body.answer).toBe("I could not find a relevant transcript segment for that question.");
    expect(body.citations).toEqual([]);
    expect(body.sessionId).toEqual(expect.any(String));
    expect(mocks.generateChatCompletion).not.toHaveBeenCalled();
  });

  it("returns a non-empty fallback answer when the model returns empty text", async () => {
    mocks.generateChatCompletion.mockResolvedValue("");
    const database = createDatabase([
      {
        id: "segment-1",
        recordingId: "recording-1",
        startTime: 12,
        endTime: 34,
        text: "Mentor hours covered customer discovery.",
        recordingTitle: "Mentor Hours",
        recordingProgramId: "program-1",
      },
    ]);
    mocks.drizzle.mockReturnValue(database);

    const response = await POST(context());
    const body = await json(response);

    expect(body.answer).toContain("I found relevant transcript references");
    expect(body.answer).toContain("Mentor Hours");
    expect(body.answer.length).toBeGreaterThan(0);
    expect(body.citations).toHaveLength(1);
  });
});
