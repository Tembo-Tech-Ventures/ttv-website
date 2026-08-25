export interface ChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

export const DEFAULT_CHAT_MODEL = "workers-ai/@cf/openai/gpt-oss-20b";

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
  response?: string;
  output_text?: string;
  output?: Array<{
    content?: Array<{
      text?: string;
      type?: string;
    }>;
  }>;
  result?: {
    response?: string;
    output_text?: string;
    output?: Array<{
      content?: Array<{
        text?: string;
        type?: string;
      }>;
    }>;
  };
}

interface ChatCompletionOptions {
  maxTokens?: number;
  temperature?: number;
}

export function extractChatCompletionText(payload: CompatChatResponse) {
  const directText =
    payload.choices?.[0]?.message?.content ??
    payload.response ??
    payload.output_text ??
    payload.result?.response ??
    payload.result?.output_text;
  if (typeof directText === "string" && directText.trim()) {
    return directText;
  }

  const outputText = [payload.output, payload.result?.output]
    .flatMap((output) => output ?? [])
    .flatMap((entry) => entry.content ?? [])
    .map((content) => content.text)
    .filter((text): text is string => typeof text === "string" && Boolean(text.trim()))
    .join("\n\n");

  return outputText;
}

/**
 * Generates a chat completion through Cloudflare AI Gateway in unified mode
 * (OpenAI-compatible API) so models can be swapped via AI_GATEWAY_MODEL and
 * billing stays unified. Falls back to the Workers AI binding (same model)
 * when the gateway is not configured.
 */
export async function generateChatCompletion(
  env: Env,
  messages: ChatMessage[],
  options: ChatCompletionOptions = {}
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
      body: JSON.stringify({
        model,
        messages,
        ...(options.maxTokens ? { max_tokens: options.maxTokens } : {}),
        ...(typeof options.temperature === "number"
          ? { temperature: options.temperature }
          : {}),
      }),
    });

    if (!response.ok) {
      throw new Error(
        `AI Gateway chat completion failed with status ${response.status}`
      );
    }

    const payload = (await response.json()) as CompatChatResponse;
    return extractChatCompletionText(payload);
  }

  // Fallback: call Workers AI directly with the same model. Unified-mode model
  // ids are prefixed with the provider ("workers-ai/"), which the binding does
  // not expect.
  const bindingModel = model.replace(/^workers-ai\//, "");
  const gatewayName = env.AI_GATEWAY_NAME?.trim();
  const result = (await env.AI.run(
    bindingModel as Parameters<typeof env.AI.run>[0],
    {
      messages,
      ...(options.maxTokens ? { max_tokens: options.maxTokens } : {}),
      ...(typeof options.temperature === "number"
        ? { temperature: options.temperature }
        : {}),
    },
    gatewayName ? { gateway: { id: gatewayName } } : undefined
  )) as CompatChatResponse;

  return extractChatCompletionText(result);
}
