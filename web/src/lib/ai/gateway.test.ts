import { afterEach, describe, expect, it, vi } from "vitest";
import {
  AiGatewayConfigurationError,
  AiGatewayResponseError,
  DEFAULT_CHAT_MODEL,
  gatewayCompatUrl,
  openChatCompletionStream,
  resolveChatModel,
  type ChatMessage,
} from "@/lib/ai/gateway";

function makeEnv(overrides: Record<string, unknown> = {}): Env {
  return overrides as unknown as Env;
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
  it("defaults to Gemma 4 in unified-mode format", () => {
    expect(resolveChatModel(makeEnv())).toBe(DEFAULT_CHAT_MODEL);
    expect(DEFAULT_CHAT_MODEL).toMatch(/^workers-ai\/@cf\/google\/gemma-4/);
  });

  it("uses a configured model and ignores a blank override", () => {
    expect(resolveChatModel(makeEnv({ AI_GATEWAY_MODEL: "dynamic/coach" }))).toBe(
      "dynamic/coach"
    );
    expect(resolveChatModel(makeEnv({ AI_GATEWAY_MODEL: "  " }))).toBe(
      DEFAULT_CHAT_MODEL
    );
  });
});

describe("gatewayCompatUrl", () => {
  it("requires both the account id and gateway name", () => {
    expect(gatewayCompatUrl(makeEnv())).toBeNull();
    expect(gatewayCompatUrl(makeEnv({ AI_GATEWAY_ACCOUNT_ID: "acc" }))).toBeNull();
    expect(gatewayCompatUrl(makeEnv({ AI_GATEWAY_NAME: "gw" }))).toBeNull();
  });

  it("builds the unified OpenAI-compatible endpoint", () => {
    expect(
      gatewayCompatUrl(
        makeEnv({ AI_GATEWAY_ACCOUNT_ID: "acc-123", AI_GATEWAY_NAME: "ttv-ai" })
      )
    ).toBe("https://gateway.ai.cloudflare.com/v1/acc-123/ttv-ai/compat/chat/completions");
  });
});

describe("openChatCompletionStream", () => {
  it("opens a streamed Gemma completion through AI Gateway", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(
        new Response('data: {"choices":[{"delta":{"content":"Hello"}}]}\n\n')
      );
    vi.stubGlobal("fetch", fetchMock);
    const signal = new AbortController().signal;
    const env = makeEnv({
      AI_GATEWAY_ACCOUNT_ID: "acc-123",
      AI_GATEWAY_NAME: "ttv-ai",
      AI_GATEWAY_API_KEY: "secret-token",
    });

    const completion = await openChatCompletionStream(env, messages, signal);

    expect(completion.model).toBe(DEFAULT_CHAT_MODEL);
    expect(completion.reader).toBeDefined();
    expect(fetchMock).toHaveBeenCalledOnce();
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe(
      "https://gateway.ai.cloudflare.com/v1/acc-123/ttv-ai/compat/chat/completions"
    );
    expect(init.signal).toBe(signal);
    expect(init.headers).toEqual({
      Authorization: "Bearer secret-token",
      "Content-Type": "application/json",
    });
    if (typeof init.body !== "string") {
      throw new Error("Expected a JSON request body.");
    }
    const requestBody: unknown = JSON.parse(init.body);
    expect(requestBody).toEqual({
      model: DEFAULT_CHAT_MODEL,
      messages,
      stream: true,
      temperature: 0.35,
      max_tokens: 1_200,
    });
  });

  it("fails closed when gateway configuration is incomplete", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    await expect(openChatCompletionStream(makeEnv(), messages)).rejects.toBeInstanceOf(
      AiGatewayConfigurationError
    );
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("rejects unsuccessful and empty gateway responses", async () => {
    const env = makeEnv({
      AI_GATEWAY_ACCOUNT_ID: "acc",
      AI_GATEWAY_NAME: "gateway",
      AI_GATEWAY_API_KEY: "token",
    });

    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(new Response("nope", { status: 429 }))
    );
    await expect(openChatCompletionStream(env, messages)).rejects.toThrow("status 429");

    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, body: null }));
    await expect(openChatCompletionStream(env, messages)).rejects.toBeInstanceOf(
      AiGatewayResponseError
    );
  });
});
