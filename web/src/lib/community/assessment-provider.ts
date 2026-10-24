import { extractChatCompletionText, gatewayCompatUrl, type GatewayMessage } from "../ai/gateway";

export const COMMUNITY_ASSESSMENT_MODEL = "workers-ai/@cf/google/gemma-4-26b-a4b-it";
export interface AssessmentProvider {
  model: string;
  complete(messages: GatewayMessage[], schema: Record<string, unknown>): Promise<string>;
}

/** Internal-only probe hook; trusted callers own role authorization and durable claims. */
export interface AssessmentProviderOptions {
  syntheticProbe?: {
    claim(measurement: { payloadBytes: number; payloadCharacters: number }): Promise<void>;
  };
}

/** One bounded unified-Gateway call. No direct binding/provider or retry fallback. */
export function createAssessmentProvider(env?: Env, options: AssessmentProviderOptions = {}): AssessmentProvider {
  const isProbe = options.syntheticProbe !== undefined;
  const claim = options.syntheticProbe?.claim;
  if (isProbe && typeof claim !== "function") {
    throw new Error("Assessment probe configuration unavailable.");
  }
  let attempted = false;
  return {
    model: COMMUNITY_ASSESSMENT_MODEL,
    async complete(messages) {
      if (isProbe && attempted) throw new Error("Assessment provider unavailable.");
      attempted = true;
      if (!env) throw new Error("Assessment configuration unavailable.");
      const url = gatewayCompatUrl(env);
      const key = env.AI_GATEWAY_API_KEY?.trim();
      if (!url || !key) throw new Error("Assessment configuration unavailable.");
      try {
        const { body, measurement } = serializeAssessmentRequest(messages, isProbe);
        // The server-owned claim must atomically exclude other HTTP attempts.
        if (measurement) await claim!(measurement);
        const response = await fetch(url, {
          method: "POST", redirect: "error", signal: AbortSignal.timeout(20_000),
          headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json", "cf-aig-skip-cache": "true" },
          body,
        });
        if (!response.ok) throw new Error();
        const text = await boundedResponseText(response);
        if (!text) return "";
        const payload = JSON.parse(text);
        const choice = payload?.choices?.[0];
        if (choice?.message?.refusal || (choice?.finish_reason && choice.finish_reason !== "stop")) return "";
        return extractChatCompletionText(payload);
      } catch {
        // Fetch/read/parse errors can retain credentials in messages or causes.
        throw new Error("Assessment provider unavailable.");
      }
    },
  };
}

function serializeAssessmentRequest(messages: GatewayMessage[], isProbe: boolean) {
  const body = JSON.stringify({ model: COMMUNITY_ASSESSMENT_MODEL, messages, temperature: 0,
    max_completion_tokens: 3000, chat_template_kwargs: { enable_thinking: false },
  });
  const measurement = isProbe
    ? { payloadCharacters: body.length, payloadBytes: new TextEncoder().encode(body).byteLength }
    : undefined;
  if (measurement && (measurement.payloadCharacters > 8000 || measurement.payloadBytes > 8000)) throw new Error();
  return { body, measurement };
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
