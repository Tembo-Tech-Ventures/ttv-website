import { extractChatCompletionText, gatewayCompatUrl, type GatewayMessage } from "../ai/gateway";

export const COMMUNITY_ASSESSMENT_MODEL = "workers-ai/@cf/google/gemma-4-26b-a4b-it";
export interface AssessmentProvider {
  model: string;
  complete(messages: GatewayMessage[], schema: Record<string, unknown>): Promise<string>;
}

/** One bounded unified-Gateway call. No direct binding/provider or retry fallback. */
export function createAssessmentProvider(env?: Env): AssessmentProvider {
  return {
    model: COMMUNITY_ASSESSMENT_MODEL,
    async complete(messages) {
      if (!env) throw new Error("Assessment configuration unavailable.");
      const url = gatewayCompatUrl(env);
      const key = env.AI_GATEWAY_API_KEY?.trim();
      if (!url || !key) throw new Error("Assessment configuration unavailable.");
      const response = await fetch(url, {
        method: "POST", redirect: "error", signal: AbortSignal.timeout(20_000),
        headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json", "cf-aig-skip-cache": "true" },
        body: JSON.stringify({ model: COMMUNITY_ASSESSMENT_MODEL, messages, temperature: 0,
          max_completion_tokens: 3000, chat_template_kwargs: { enable_thinking: false },
        }),
      });
      if (!response.ok) throw new Error("Assessment provider unavailable.");
      const text = await boundedResponseText(response);
      if (!text) return "";
      const payload = JSON.parse(text);
      const choice = payload?.choices?.[0];
      if (choice?.message?.refusal || (choice?.finish_reason && choice.finish_reason !== "stop")) return "";
      return extractChatCompletionText(payload);
    },
  };
}

async function boundedResponseText(response: Response) {
  // Bound successful payloads too; never surface raw upstream response bodies.
  const reader = response.body?.getReader();
  if (!reader) return "";
  const decoder = new TextDecoder();
  let text = "";
  let bytes = 0;
  try {
    while (true) {
      const chunk = await reader.read();
      if (chunk.done) break;
      bytes += chunk.value.byteLength;
      if (bytes > 64_000) { await reader.cancel(); return ""; }
      text += decoder.decode(chunk.value, { stream: true });
    }
    text += decoder.decode();
  } finally { reader.releaseLock(); }
  return text;
}
