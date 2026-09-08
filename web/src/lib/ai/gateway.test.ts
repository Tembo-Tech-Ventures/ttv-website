import { afterEach, describe, expect, it, vi } from "vitest";
import {
  DEFAULT_CHAT_MODEL,
  extractChatCompletionText,
  gatewayCompatUrl,
  generateChatCompletion,
  generateToolCompletion,
  resolveChatModel,
  type ChatMessage,
  type GatewayMessage,
  type ToolDefinition,
} from "@/lib/ai/gateway";

function makeEnv(overrides: Record<string, unknown> = {}) {
  return {
    AI: { run: vi.fn() },
    ...overrides,
  } as unknown as Env;
}

const messages: ChatMessage[] = [
  { role: "system", content: "You are helpful." },
  { role: "user", content: "What is TTV?" },
];

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("resolveChatModel", () => {
  it("defaults to the GPT OSS reasoning model in unified-mode format", () => {
    expect(resolveChatModel(makeEnv())).toBe(DEFAULT_CHAT_MODEL);
    expect(DEFAULT_CHAT_MODEL).toBe("workers-ai/@cf/openai/gpt-oss-20b");
  });

  it("uses AI_GATEWAY_MODEL when set", () => {
    const env = makeEnv({ AI_GATEWAY_MODEL: "openai/gpt-test" });
    expect(resolveChatModel(env)).toBe("openai/gpt-test");
  });

  it("ignores blank AI_GATEWAY_MODEL", () => {
    const env = makeEnv({ AI_GATEWAY_MODEL: "  " });
    expect(resolveChatModel(env)).toBe(DEFAULT_CHAT_MODEL);
  });
});

describe("gatewayCompatUrl", () => {
  it("returns null when account id or gateway name is missing", () => {
    expect(gatewayCompatUrl(makeEnv())).toBeNull();
    expect(gatewayCompatUrl(makeEnv({ AI_GATEWAY_ACCOUNT_ID: "acc" }))).toBeNull();
    expect(gatewayCompatUrl(makeEnv({ AI_GATEWAY_NAME: "gw" }))).toBeNull();
  });

  it("builds the unified-mode compat endpoint", () => {
    const env = makeEnv({
      AI_GATEWAY_ACCOUNT_ID: "acc-123",
      AI_GATEWAY_NAME: "ttv-ai",
    });
    expect(gatewayCompatUrl(env)).toBe(
      "https://gateway.ai.cloudflare.com/v1/acc-123/ttv-ai/compat/chat/completions"
    );
  });
});

describe("extractChatCompletionText", () => {
  it("reads Chat Completions responses", () => {
    expect(
      extractChatCompletionText({
        choices: [{ message: { content: "Chat completion text" } }],
      })
    ).toBe("Chat completion text");
  });

  it("reads direct Workers AI text responses", () => {
    expect(extractChatCompletionText({ response: "Workers AI text" })).toBe(
      "Workers AI text"
    );
  });

  it("reads Responses API output text", () => {
    expect(
      extractChatCompletionText({
        output: [
          {
            content: [
              { type: "output_text", text: "Responses API text" },
            ],
          },
        ],
      })
    ).toBe("Responses API text");
  });

  it("reads nested Responses API output text", () => {
    expect(
      extractChatCompletionText({
        result: {
          output: [
            {
              content: [{ type: "output_text", text: "Nested response text" }],
            },
          ],
        },
      })
    ).toBe("Nested response text");
  });
});

describe("generateChatCompletion", () => {
  it("calls the AI Gateway compat endpoint with an OpenAI-style payload", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({ choices: [{ message: { content: "An answer" } }] }),
        { status: 200 }
      )
    );
    vi.stubGlobal("fetch", fetchMock);

    const env = makeEnv({
      AI_GATEWAY_ACCOUNT_ID: "acc-123",
      AI_GATEWAY_NAME: "ttv-ai",
      AI_GATEWAY_API_KEY: "secret-token",
    });

    const answer = await generateChatCompletion(env, messages, {
      maxTokens: 900,
      temperature: 0.2,
    });

    expect(answer).toBe("An answer");
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe(
      "https://gateway.ai.cloudflare.com/v1/acc-123/ttv-ai/compat/chat/completions"
    );
    expect(init.method).toBe("POST");
    expect(init.headers.Authorization).toBe("Bearer secret-token");
    expect(JSON.parse(init.body)).toEqual({
      model: DEFAULT_CHAT_MODEL,
      messages,
      max_tokens: 900,
      temperature: 0.2,
    });
    expect((env.AI.run as ReturnType<typeof vi.fn>)).not.toHaveBeenCalled();
  });

  it("throws when the gateway responds with a non-2xx status", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(new Response("nope", { status: 401 }))
    );

    const env = makeEnv({
      AI_GATEWAY_ACCOUNT_ID: "acc-123",
      AI_GATEWAY_NAME: "ttv-ai",
      AI_GATEWAY_API_KEY: "secret-token",
    });

    await expect(generateChatCompletion(env, messages)).rejects.toThrow(
      "AI Gateway chat completion failed with status 401"
    );
  });

  it("returns an empty string when the gateway response has no content", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ choices: [] }), { status: 200 })
      )
    );

    const env = makeEnv({
      AI_GATEWAY_ACCOUNT_ID: "acc-123",
      AI_GATEWAY_NAME: "ttv-ai",
      AI_GATEWAY_API_KEY: "secret-token",
    });

    await expect(generateChatCompletion(env, messages)).resolves.toBe("");
  });

  it("falls back to the Workers AI binding when no API key is configured", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const run = vi.fn().mockResolvedValue({ response: "Binding answer" });
    const env = makeEnv({
      AI: { run },
      AI_GATEWAY_ACCOUNT_ID: "acc-123",
      AI_GATEWAY_NAME: "ttv-ai",
    });

    const answer = await generateChatCompletion(env, messages);

    expect(answer).toBe("Binding answer");
    expect(fetchMock).not.toHaveBeenCalled();
    expect(run).toHaveBeenCalledWith(
      "@cf/openai/gpt-oss-20b",
      { messages },
      { gateway: { id: "ttv-ai" } }
    );
  });

  it("omits the gateway option in fallback mode when no gateway is configured", async () => {
    const run = vi.fn().mockResolvedValue({ result: { response: "Nested" } });
    const env = makeEnv({ AI: { run } });

    const answer = await generateChatCompletion(env, messages);

    expect(answer).toBe("Nested");
    expect(run).toHaveBeenCalledWith(
      "@cf/openai/gpt-oss-20b",
      { messages },
      undefined
    );
  });
});

const toolMessages: GatewayMessage[] = [
  { role: "system", content: "You are helpful." },
  { role: "user", content: "Search for something" },
];

const sampleTools: ToolDefinition[] = [
  {
    type: "function",
    function: {
      name: "search",
      description: "Search transcripts",
      parameters: { type: "object", properties: { query: { type: "string" } }, required: ["query"] },
    },
  },
];

describe("generateToolCompletion", () => {
  it("returns content and empty toolCalls for a normal response", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({
            choices: [{ message: { content: "An answer" }, finish_reason: "stop" }],
          }),
          { status: 200 }
        )
      )
    );

    const env = makeEnv({
      AI_GATEWAY_ACCOUNT_ID: "acc-123",
      AI_GATEWAY_NAME: "ttv-ai",
      AI_GATEWAY_API_KEY: "secret",
    });

    const result = await generateToolCompletion(env, toolMessages);

    expect(result.content).toBe("An answer");
    expect(result.toolCalls).toEqual([]);
    expect(result.finishReason).toBe("stop");
  });

  it("returns tool_calls when the model requests them", async () => {
    const toolCall = {
      id: "call-1",
      type: "function",
      function: { name: "search", arguments: '{"query":"test"}' },
    };
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({
            choices: [{
              message: { content: null, tool_calls: [toolCall] },
              finish_reason: "tool_calls",
            }],
          }),
          { status: 200 }
        )
      )
    );

    const env = makeEnv({
      AI_GATEWAY_ACCOUNT_ID: "acc-123",
      AI_GATEWAY_NAME: "ttv-ai",
      AI_GATEWAY_API_KEY: "secret",
    });

    const result = await generateToolCompletion(env, toolMessages, { tools: sampleTools });

    expect(result.content).toBeNull();
    expect(result.toolCalls).toHaveLength(1);
    expect(result.toolCalls[0].function.name).toBe("search");
    expect(result.finishReason).toBe("tool_calls");
  });

  it("sends tools and tool_choice in the request body", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({ choices: [{ message: { content: "ok" }, finish_reason: "stop" }] }),
        { status: 200 }
      )
    );
    vi.stubGlobal("fetch", fetchMock);

    const env = makeEnv({
      AI_GATEWAY_ACCOUNT_ID: "acc-123",
      AI_GATEWAY_NAME: "ttv-ai",
      AI_GATEWAY_API_KEY: "secret",
    });

    await generateToolCompletion(env, toolMessages, { tools: sampleTools });

    const body = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(body.tools).toEqual(sampleTools);
    expect(body.tool_choice).toBe("auto");
  });

  it("does not send tools when the tools array is empty", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({ choices: [{ message: { content: "ok" }, finish_reason: "stop" }] }),
        { status: 200 }
      )
    );
    vi.stubGlobal("fetch", fetchMock);

    const env = makeEnv({
      AI_GATEWAY_ACCOUNT_ID: "acc-123",
      AI_GATEWAY_NAME: "ttv-ai",
      AI_GATEWAY_API_KEY: "secret",
    });

    await generateToolCompletion(env, toolMessages, { tools: [] });

    const body = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(body).not.toHaveProperty("tools");
    expect(body).not.toHaveProperty("tool_choice");
  });

  it("falls back to Workers AI binding and returns text-only result", async () => {
    const run = vi.fn().mockResolvedValue({ response: "Binding answer" });
    const env = makeEnv({ AI: { run } });

    const result = await generateToolCompletion(env, toolMessages);

    expect(result.content).toBe("Binding answer");
    expect(result.toolCalls).toEqual([]);
    expect(result.finishReason).toBe("stop");
  });
});
