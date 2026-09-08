import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  env: {
    DB: {} as Record<string, unknown>,
    AI: { run: vi.fn() },
    VECTORIZE: { query: vi.fn() },
  },
  drizzle: vi.fn(),
  getAccessibleProgramIds: vi.fn(),
  generateToolCompletion: vi.fn(),
  executeTool: vi.fn(),
  ensureOwnedChatSession: vi.fn(),
  touchChatSession: vi.fn(),
}));

vi.mock("cloudflare:workers", () => ({ env: mocks.env }));
vi.mock("drizzle-orm/d1", () => ({ drizzle: mocks.drizzle }));
vi.mock("@/lib/recordings/access", () => ({
  getAccessibleProgramIds: mocks.getAccessibleProgramIds,
}));
vi.mock("@/lib/ai/gateway", () => ({
  generateToolCompletion: mocks.generateToolCompletion,
}));
vi.mock("@/lib/chat/tools", async (importOriginal) => {
  const actual = (await importOriginal()) as Record<string, unknown>;
  return { ...actual, executeTool: mocks.executeTool };
});
vi.mock("@/lib/chat/sessions", () => ({
  ensureOwnedChatSession: mocks.ensureOwnedChatSession,
  touchChatSession: mocks.touchChatSession,
}));

import { POST } from "./chat";

interface ChatResponse {
  sessionId?: string;
  answer?: string;
  citations?: Array<Record<string, unknown>>;
  error?: string;
}

async function json(response: Response) {
  return response.json() as Promise<ChatResponse>;
}

function postRequest(body: Record<string, unknown> = {}) {
  return new Request("https://example.com/api/chat", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ message: "What happened in mentor hours?", ...body }),
  });
}

function context(overrides: Partial<{ user: Record<string, unknown> | null; isAdmin: boolean }> = {}) {
  return {
    request: postRequest(),
    locals: {
      user: { id: "user-1", name: "Test User" },
      isAdmin: false,
      ...overrides,
    },
  } as Parameters<typeof POST>[0];
}

function createD1Mock(adminResult: Record<string, unknown> | null = null) {
  const run = vi.fn().mockResolvedValue({ meta: { changes: 1 } });
  const first = vi.fn().mockResolvedValue(adminResult);
  const all = vi.fn().mockResolvedValue({ results: [] });
  const bind = vi.fn(() => ({ run, first, all }));
  const prepare = vi.fn(() => ({ bind }));
  return { prepare, bind, run, first, all };
}

function createDrizzleMock() {
  const values = vi.fn().mockResolvedValue(undefined);
  const insert = vi.fn(() => ({ values }));
  return { insert, values, query: {} };
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.env.DB = createD1Mock();
  mocks.getAccessibleProgramIds.mockResolvedValue(["program-1"]);
  mocks.ensureOwnedChatSession.mockResolvedValue("session-1");
  mocks.touchChatSession.mockResolvedValue(undefined);
  mocks.generateToolCompletion.mockResolvedValue({
    content: "Here is your answer based on the transcripts.",
    toolCalls: [],
    finishReason: "stop",
  });
  mocks.drizzle.mockReturnValue(createDrizzleMock());
});

describe("POST /api/chat", () => {
  it("returns 401 when not authenticated", async () => {
    const response = await POST(context({ user: null }));
    expect(response.status).toBe(401);
  });

  it("returns 400 when message is missing", async () => {
    const ctx = {
      ...context(),
      request: postRequest({ message: undefined }),
    } as Parameters<typeof POST>[0];
    const response = await POST(ctx);
    expect(response.status).toBe(400);
  });

  it("returns 400 when message exceeds 2000 characters", async () => {
    const ctx = {
      ...context(),
      request: postRequest({ message: "x".repeat(2001) }),
    } as Parameters<typeof POST>[0];
    const response = await POST(ctx);
    expect(response.status).toBe(400);
  });

  it("calls the model with tools and returns the answer for enrolled users", async () => {
    const response = await POST(context());
    const body = await json(response);

    expect(response.status).toBe(200);
    expect(body.answer).toBe("Here is your answer based on the transcripts.");
    expect(body.sessionId).toBe("session-1");
    expect(body.citations).toEqual([]);

    expect(mocks.generateToolCompletion).toHaveBeenCalledTimes(1);
    const [, messages, options] = mocks.generateToolCompletion.mock.calls[0];
    expect(messages[0].role).toBe("system");
    expect(messages[0].content).toContain("Test User");
    expect(options.tools).toBeDefined();
    expect(options.tools.length).toBe(5);
  });

  it("runs the agent loop when the model requests tool calls", async () => {
    mocks.generateToolCompletion
      .mockResolvedValueOnce({
        content: null,
        toolCalls: [
          { id: "call-1", type: "function", function: { name: "search_transcripts", arguments: '{"query":"mentor hours"}' } },
        ],
        finishReason: "tool_calls",
      })
      .mockResolvedValueOnce({
        content: "Based on the transcripts, here is what happened.",
        toolCalls: [],
        finishReason: "stop",
      });

    mocks.executeTool.mockResolvedValue(JSON.stringify({ results: [] }));

    const response = await POST(context());
    const body = await json(response);

    expect(mocks.generateToolCompletion).toHaveBeenCalledTimes(2);
    expect(mocks.executeTool).toHaveBeenCalledWith(
      "search_transcripts",
      { query: "mentor hours" },
      expect.objectContaining({ userId: "user-1" })
    );
    expect(body.answer).toBe("Based on the transcripts, here is what happened.");
  });

  it("caps tool rounds at MAX_TOOL_ROUNDS and drops tools on the final call", async () => {
    mocks.generateToolCompletion.mockResolvedValue({
      content: null,
      toolCalls: [
        { id: "call-x", type: "function", function: { name: "get_user_context", arguments: "{}" } },
      ],
      finishReason: "tool_calls",
    });
    mocks.executeTool.mockResolvedValue("{}");

    // Override the last call to return content
    mocks.generateToolCompletion.mockResolvedValueOnce({
      content: null,
      toolCalls: [{ id: "call-1", type: "function", function: { name: "get_user_context", arguments: "{}" } }],
      finishReason: "tool_calls",
    });
    mocks.generateToolCompletion.mockResolvedValueOnce({
      content: null,
      toolCalls: [{ id: "call-2", type: "function", function: { name: "get_user_context", arguments: "{}" } }],
      finishReason: "tool_calls",
    });
    mocks.generateToolCompletion.mockResolvedValueOnce({
      content: null,
      toolCalls: [{ id: "call-3", type: "function", function: { name: "get_user_context", arguments: "{}" } }],
      finishReason: "tool_calls",
    });
    // Round 4 (MAX_TOOL_ROUNDS=3, so round index 3 is the last round with no tools)
    mocks.generateToolCompletion.mockResolvedValueOnce({
      content: "Final answer after max rounds.",
      toolCalls: [],
      finishReason: "stop",
    });

    const response = await POST(context());
    const body = await json(response);

    // 3 rounds with tools + 1 final without = 4 calls
    expect(mocks.generateToolCompletion).toHaveBeenCalledTimes(4);
    // The last call should have no tools
    const lastCallOptions = mocks.generateToolCompletion.mock.calls[3][2];
    expect(lastCallOptions.tools).toBeUndefined();
    expect(body.answer).toBe("Final answer after max rounds.");
  });

  it("provides a fallback answer when the model returns empty text", async () => {
    mocks.generateToolCompletion.mockResolvedValue({
      content: "",
      toolCalls: [],
      finishReason: "stop",
    });

    const response = await POST(context());
    const body = await json(response);

    expect(body.answer).toContain("try rephrasing");
  });

  it("does not block non-enrolled users — gives them limited tools instead", async () => {
    mocks.getAccessibleProgramIds.mockResolvedValue([]);

    const response = await POST(context());
    const body = await json(response);

    expect(response.status).toBe(200);
    expect(body.answer).toBe("Here is your answer based on the transcripts.");

    const [, messages, options] = mocks.generateToolCompletion.mock.calls[0];
    expect(messages[0].content).toContain("does not have access to session recordings");
    const toolNames = options.tools.map((t: { function: { name: string } }) => t.function.name);
    expect(toolNames).toContain("get_user_context");
    expect(toolNames).toContain("get_program_info");
    expect(toolNames).not.toContain("search_transcripts");
    expect(toolNames).not.toContain("list_recordings");
    expect(toolNames).not.toContain("get_recording_details");
  });

  it("checks admin status via D1 instead of relying on middleware", async () => {
    mocks.getAccessibleProgramIds.mockResolvedValue([]);
    mocks.env.DB = createD1Mock({ id: "admin-role-1" });

    const response = await POST(context());
    const body = await json(response);

    // Admin should get all tools even with no program ids
    expect(response.status).toBe(200);
    const [, messages, options] = mocks.generateToolCompletion.mock.calls[0];
    expect(messages[0].content).not.toContain("does not have access");
    expect(options.tools.length).toBe(5);
    expect(body.answer).toBeTruthy();
  });

  it("persists both user and assistant messages", async () => {
    const db = createDrizzleMock();
    mocks.drizzle.mockReturnValue(db);

    await POST(context());

    expect(db.insert).toHaveBeenCalled();
    expect(db.values).toHaveBeenCalledWith([
      expect.objectContaining({ role: "user", sessionId: "session-1" }),
      expect.objectContaining({ role: "assistant", sessionId: "session-1" }),
    ]);
    expect(mocks.touchChatSession).toHaveBeenCalledWith(
      mocks.env.DB,
      "user-1",
      "session-1"
    );
  });

  it("strips <think> blocks from the model answer", async () => {
    mocks.generateToolCompletion.mockResolvedValue({
      content: "<think>I should search first</think>The answer is clear.",
      toolCalls: [],
      finishReason: "stop",
    });

    const response = await POST(context());
    const body = await json(response);

    expect(body.answer).toBe("The answer is clear.");
    expect(body.answer).not.toContain("<think>");
  });
});
