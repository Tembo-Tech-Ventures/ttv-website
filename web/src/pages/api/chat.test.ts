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

beforeEach(() => {
  vi.clearAllMocks();
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
    mocks.drizzle.mockReturnValue(createDatabase());

    const response = await POST(context());
    const body = await json(response);

    expect(body).toEqual({
      answer: "No session recordings are available for your account yet.",
      citations: [],
    });
    expect(mocks.env.VECTORIZE.query).not.toHaveBeenCalled();
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

    expect(body).toEqual({
      answer: "I could not find a relevant transcript segment for that question.",
      citations: [],
    });
    expect(mocks.generateChatCompletion).not.toHaveBeenCalled();
  });
});
