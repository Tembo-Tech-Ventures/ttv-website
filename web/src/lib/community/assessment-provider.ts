import { extractChatCompletionText, type GatewayMessage } from "../ai/gateway";

import { requireCommunityGateway, runCommunityModel } from "./native-gateway";

export const COMMUNITY_ASSESSMENT_MODEL = "workers-ai/@cf/google/gemma-4-26b-a4b-it";
export type AssessmentOutputReason = "response_shape" | "refusal" | "finish_reason" | "empty_content" | "output_size" | "json" | "schema" | "criterion" | "citation";
export interface AssessmentProvider {
  model: string;
  reportInvalidOutput?: (reason: AssessmentOutputReason) => void;
  complete(messages: GatewayMessage[], schema: Record<string, unknown>): Promise<string>;
}

/** Internal-only probe hook; trusted callers own role authorization and durable claims. */
export interface AssessmentProviderOptions {
  syntheticProbe?: {
    reportInvalidOutput?: (reason: AssessmentOutputReason) => void;
    claim(measurement: { payloadBytes: number; payloadCharacters: number }): Promise<void>;
  };
}

/** One bounded Gateway-routed binding call. No direct/provider or retry fallback. */
export function createAssessmentProvider(env?: Env, options: AssessmentProviderOptions = {}): AssessmentProvider {
  const isProbe = options.syntheticProbe !== undefined;
  const claim = options.syntheticProbe?.claim;
  if (isProbe && typeof claim !== "function") {
    throw new Error("Assessment probe configuration unavailable.");
  }
  let attempted = false;
  let reported = false;
  const reportInvalidOutput = (reason: AssessmentOutputReason) => {
    if (!reported) { reported = true; options.syntheticProbe?.reportInvalidOutput?.(reason); }
  };
  return {
    model: COMMUNITY_ASSESSMENT_MODEL,
    reportInvalidOutput,
    async complete(messages) {
      if (isProbe && attempted) throw new Error("Assessment provider unavailable.");
      attempted = true;
      if (!env) throw new Error("Assessment configuration unavailable.");
      requireCommunityGateway(env);
      try {
        const { body, measurement } = serializeAssessmentRequest(messages, isProbe);
        // The server-owned claim must atomically exclude other binding attempts.
        if (measurement) await claim!(measurement);
        const payload = await runCommunityModel(env, JSON.parse(body)) as { choices?: Array<{ message?: { content?: string; refusal?: string }; finish_reason?: string }> };
        const choice = payload?.choices?.[0];
        if (!Array.isArray(payload?.choices) || payload.choices.length !== 1 || !choice?.message) { reportInvalidOutput("response_shape"); return ""; }
        if (choice.message.refusal) { reportInvalidOutput("refusal"); return ""; }
        if (choice.finish_reason !== "stop") { reportInvalidOutput("finish_reason"); return ""; }
        if (typeof choice.message.content !== "string") { reportInvalidOutput("response_shape"); return ""; }
        const content = extractChatCompletionText(payload);
        if (!content.trim()) reportInvalidOutput("empty_content");
        return content;
      } catch {
        // Fetch/read/parse errors can retain credentials in messages or causes.
        throw new Error("Assessment provider unavailable.");
      }
    },
  };
}

function serializeAssessmentRequest(messages: GatewayMessage[], isProbe: boolean) {
  const body = JSON.stringify({ messages, stream: false, temperature: 0,
    response_format: { type: "json_object" },
    max_completion_tokens: 3000, chat_template_kwargs: { enable_thinking: false },
  });
  const measurement = isProbe
    ? { payloadCharacters: body.length, payloadBytes: new TextEncoder().encode(body).byteLength }
    : undefined;
  if (measurement && (measurement.payloadCharacters > 8000 || measurement.payloadBytes > 8000)) throw new Error();
  return { body, measurement };
}
