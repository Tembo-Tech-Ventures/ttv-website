import type { GatewayMessage, ToolCompletionResult, ToolDefinition } from "@/lib/ai/gateway";
import { generateToolCompletion } from "@/lib/community/native-gateway";
import { TEMBO_CONFIG } from "./config";

/**
 * One model call for Tembo: Gemma 4 through the AI Gateway binding, without logging prompts in the
 * gateway (collectLog false), with one attempt and a bounded response (community/native-gateway.ts).
 * Tests pass their own.
 */
export type TemboModel = (messages: GatewayMessage[], tools: ToolDefinition[] | undefined) => Promise<ToolCompletionResult>;

export function gatewayModel(env: Partial<Pick<Env, "AI" | "AI_GATEWAY_NAME">>): TemboModel {
  return (messages, tools) => generateToolCompletion(env as Env, messages, { tools, maxTokens: TEMBO_CONFIG.maxTokens, temperature: 0.1 });
}
