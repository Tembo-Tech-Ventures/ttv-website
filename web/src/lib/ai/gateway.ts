export interface ChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

export interface ChatCompletionStream {
  model: string;
  reader: ReadableStreamDefaultReader<Uint8Array>;
}

export const DEFAULT_CHAT_MODEL = "workers-ai/@cf/google/gemma-4-26b-a4b-it";

export class AiGatewayConfigurationError extends Error {
  override readonly name = "AiGatewayConfigurationError";
}

export class AiGatewayResponseError extends Error {
  override readonly name = "AiGatewayResponseError";
}

export function resolveChatModel(env: Env): string {
  const configuredModel = env.AI_GATEWAY_MODEL?.trim();
  if (!configuredModel) return DEFAULT_CHAT_MODEL;
  return configuredModel;
}

export function gatewayCompatUrl(env: Env): string | null {
  const accountId = env.AI_GATEWAY_ACCOUNT_ID?.trim();
  const gatewayName = env.AI_GATEWAY_NAME?.trim();
  if (!accountId || !gatewayName) return null;

  return `https://gateway.ai.cloudflare.com/v1/${accountId}/${gatewayName}/compat/chat/completions`;
}

/**
 * Opens an OpenAI-compatible streaming completion through Cloudflare AI
 * Gateway. Chat deliberately has no direct-provider fallback: missing gateway
 * credentials fail closed so billing, observability, and model policy cannot be
 * bypassed by an environment drift.
 */
export async function openChatCompletionStream(
  env: Env,
  messages: ChatMessage[],
  signal?: AbortSignal
): Promise<ChatCompletionStream> {
  const url = gatewayCompatUrl(env);
  const apiKey = env.AI_GATEWAY_API_KEY?.trim();
  if (!url || !apiKey) {
    throw new AiGatewayConfigurationError(
      "Cloudflare AI Gateway is not configured for chat."
    );
  }

  const model = resolveChatModel(env);
  const response = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model,
      messages,
      stream: true,
      temperature: 0.35,
      max_tokens: 1_200,
    }),
    ...(signal ? { signal } : {}),
  });

  if (!response.ok) {
    throw new AiGatewayResponseError(
      `AI Gateway chat completion failed with status ${response.status}.`
    );
  }
  if (!response.body) {
    throw new AiGatewayResponseError(
      "AI Gateway chat completion returned no response stream."
    );
  }

  return { model, reader: response.body.getReader() };
}
