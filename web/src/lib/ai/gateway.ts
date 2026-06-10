export interface ChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

export const DEFAULT_CHAT_MODEL = "workers-ai/@cf/google/gemma-4-26b-a4b-it";

export function resolveChatModel(env: Env) {
  return env.AI_GATEWAY_MODEL?.trim() || DEFAULT_CHAT_MODEL;
}

export function gatewayCompatUrl(env: Env) {
  const accountId = env.AI_GATEWAY_ACCOUNT_ID?.trim();
  const gatewayName = env.AI_GATEWAY_NAME?.trim();
  if (!accountId || !gatewayName) {
    return null;
  }

  return `https://gateway.ai.cloudflare.com/v1/${accountId}/${gatewayName}/compat/chat/completions`;
}

interface CompatChatResponse {
  choices?: Array<{ message?: { content?: string } }>;
}

/**
 * Generates a chat completion through Cloudflare AI Gateway in unified mode
 * (OpenAI-compatible API) so models can be swapped via AI_GATEWAY_MODEL and
 * billing stays unified. Falls back to the Workers AI binding (same model)
 * when the gateway is not configured.
 */
export async function generateChatCompletion(
  env: Env,
  messages: ChatMessage[]
): Promise<string> {
  const model = resolveChatModel(env);
  const url = gatewayCompatUrl(env);
  const apiKey = env.AI_GATEWAY_API_KEY?.trim();

  if (url && apiKey) {
    const response = await fetch(url, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ model, messages }),
    });

    if (!response.ok) {
      throw new Error(
        `AI Gateway chat completion failed with status ${response.status}`
      );
    }

    const payload = (await response.json()) as CompatChatResponse;
    return payload.choices?.[0]?.message?.content ?? "";
  }

  // Fallback: call Workers AI directly with the same model. Unified-mode model
  // ids are prefixed with the provider ("workers-ai/"), which the binding does
  // not expect.
  const bindingModel = model.replace(/^workers-ai\//, "");
  const gatewayName = env.AI_GATEWAY_NAME?.trim();
  const result = (await env.AI.run(
    bindingModel as Parameters<typeof env.AI.run>[0],
    { messages },
    gatewayName ? { gateway: { id: gatewayName } } : undefined
  )) as { response?: string; result?: { response?: string } };

  return result.response ?? result.result?.response ?? "";
}
