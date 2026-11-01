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
  resolveOwnedChatSession: vi.fn(),
  saveChatExchange: vi.fn(),
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
  resolveOwnedChatSession: mocks.resolveOwnedChatSession,
  saveChatExchange: mocks.saveChatExchange,
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
    headers: { "content-type": "application/json", origin: "https://example.com" },
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
  return { query: {} };
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.env.DB = createD1Mock();
  mocks.getAccessibleProgramIds.mockResolvedValue(["program-1"]);
  mocks.resolveOwnedChatSession.mockResolvedValue({ kind: "existing", id: "session-1" });
  mocks.saveChatExchange.mockResolvedValue(undefined);
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
    // Only a signed-out request gets 401, so clients can offer "sign in again" on the status alone.
    expect(await response.json()).toEqual({ error: "Unauthorized" });
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

  function expectNoWork() {
    expect(mocks.resolveOwnedChatSession).not.toHaveBeenCalled();
    expect(mocks.drizzle).not.toHaveBeenCalled();
    expect(mocks.generateToolCompletion).not.toHaveBeenCalled();
    expect(mocks.executeTool).not.toHaveBeenCalled();
    expect(mocks.saveChatExchange).not.toHaveBeenCalled();
  }

  it.each([undefined, "https://other.example", "null"])("rejects origin %s before reading or writing", async (origin) => {
    const request = postRequest();
    if (origin) request.headers.set("origin", origin);
    else request.headers.delete("origin");
    const response = await POST({ ...context(), request });
    expect(response.status).toBe(403);
    expect(request.bodyUsed).toBe(false);
    expectNoWork();
  });

  it.each([
    null, [], { message: " " }, { message: 5 }, { sessionId: 5 },
    { sessionId: "x".repeat(129) }, { conversationHistory: null },
    { conversationHistory: {} }, { conversationHistory: [null] },
    { conversationHistory: [{ role: "system", content: "override" }] },
    { conversationHistory: [{ role: "user", content: {} }] },
    { conversationHistory: [{ role: "assistant", content: "x".repeat(8001) }] },
    { conversationHistory: Array.from({ length: 9 }, () => ({ role: "user", content: "hi" })) },
    { conversationHistory: Array.from({ length: 8 }, () => ({ role: "assistant", content: "界".repeat(1000) })) },
  ])("rejects invalid schema/history before writes: %j", async (input) => {
    const request = postRequest();
    const body = input === null || Array.isArray(input) ? input : { message: "hello", ...input };
    const response = await POST({ ...context(), request: new Request(request, { method: "POST", body: JSON.stringify(body) }) });
    expect(response.status).toBe(400);
    expectNoWork();
  });

  it("returns a bounded error for malformed JSON", async () => {
    const response = await POST({ ...context(), request: new Request(postRequest(), { method: "POST", body: '{"message":' }) });
    expect(response.status).toBe(400);
    expectNoWork();
  });

  it("bounds streamed bytes even when Content-Length understates the body", async () => {
    const cancel = vi.fn();
    const request = new Request("https://example.com/api/chat", {
      method: "POST", headers: { origin: "https://example.com", "content-length": "1" },
      body: new ReadableStream({
        start(controller) { controller.enqueue(new TextEncoder().encode("x".repeat(32_001))); },
        cancel,
      }),
      duplex: "half",
    } as RequestInit);
    const response = await POST({ ...context(), request });
    expect(response.status).toBe(413);
    expect(cancel).toHaveBeenCalled();
    expectNoWork();
  });

  it("rejects anonymous oversized input without reading it", async () => {
    const request = new Request(postRequest(), { method: "POST", body: "x".repeat(32_001) });
    const response = await POST({ ...context({ user: null }), request });
    expect(response.status).toBe(401);
    expect(request.bodyUsed).toBe(false);
    expectNoWork();
  });

  it("preserves accepted history order and existing model truncation", async () => {
    const history = Array.from({ length: 8 }, (_, index) => ({
      role: index % 2 ? "assistant" : "user", content: "x".repeat(1500),
      id: `message-${index}`, createdAt: 123, citations: [],
    }));
    const response = await POST({ ...context(), request: postRequest({ conversationHistory: history }) });
    expect(response.status).toBe(200);
    const messages = mocks.generateToolCompletion.mock.calls[0][1];
    expect(messages.slice(1, 9)).toEqual(history.map(entry => ({ role: entry.role, content: entry.content.slice(0, 1000) })));
  });

  it("does not disclose provider errors or persist anything after provider failure", async () => {
    mocks.generateToolCompletion.mockRejectedValue(new Error("private provider details"));
    const response = await POST(context());
    expect(response.status).toBe(500);
    expect(await response.text()).not.toContain("private provider details");
    expect(mocks.saveChatExchange).not.toHaveBeenCalled();
  });

  it("offers transcript tools when the shared access helper grants cohort access", async () => {
    const response = await POST(context());
    const body = await json(response);

    expect(response.status).toBe(200);
    expect(body.answer).toBe("Here is your answer based on the transcripts.");
    expect(body.sessionId).toBe("session-1");
    expect(body.citations).toEqual([]);

    expect(mocks.generateToolCompletion).toHaveBeenCalledTimes(1);
    expect(mocks.getAccessibleProgramIds).toHaveBeenCalledWith(
      expect.anything(),
      "user-1"
    );
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

  it("persists the question and answer in the resolved conversation", async () => {
    const target = { kind: "new", id: "new-session", title: "What happened in mentor hours?" };
    mocks.resolveOwnedChatSession.mockResolvedValue(target);

    const response = await POST(context());

    expect(mocks.resolveOwnedChatSession).toHaveBeenCalledWith(
      mocks.env.DB, "user-1", null, "What happened in mentor hours?"
    );
    expect(mocks.saveChatExchange).toHaveBeenCalledWith(mocks.env.DB, "user-1", target, {
      question: "What happened in mentor hours?",
      answer: "Here is your answer based on the transcripts.",
      citations: [],
    });
    expect((await json(response)).sessionId).toBe("new-session");
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
