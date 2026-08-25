import { afterEach, describe, expect, it, vi } from "vitest";
import {
  DEFAULT_CHAT_MODEL,
  gatewayCompatUrl,
  generateChatCompletion,
  resolveChatModel,
  type ChatMessage,
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
