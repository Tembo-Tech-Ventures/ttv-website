import { z } from "zod";
import type { GatewayMessage, ToolCompletionResult, ToolDefinition } from "../ai/gateway";

export const COMMUNITY_NATIVE_MODEL = "@cf/google/gemma-4-26b-a4b-it";
export function requireCommunityGateway(env?: Env): asserts env is Env & { AI_GATEWAY_NAME: string } {
  if (!env?.AI || typeof env.AI.run !== "function" || !env.AI_GATEWAY_NAME?.trim() || env.AI_GATEWAY_NAME.trim() === "default") {
    throw new Error("Community model configuration unavailable: existing Gateway and AI binding required.");
  }
}

/** Explicit authenticated binding route; never direct inference, HTTP fallback or application retry. */
export async function runCommunityModel(env: Env, inputs: Record<string, unknown>): Promise<unknown> {
  return runDiscoveryModel(env, COMMUNITY_NATIVE_MODEL, inputs, 64_000);
}

export async function runDiscoveryModel(env: Env, model: string, inputs: Record<string, unknown>, maxBytes = 1_000_000): Promise<unknown> {
  requireCommunityGateway(env);
  try {
    const response = await env.AI.run(model as Parameters<typeof env.AI.run>[0], inputs, {
      returnRawResponse: true,
      signal: AbortSignal.timeout(20_000),
      gateway: { id: env.AI_GATEWAY_NAME.trim(), skipCache: true, collectLog: false,
        requestTimeoutMs: 20_000, retries: { maxAttempts: 1 } },
    });
    if (!(response instanceof Response) || !response.ok) throw new Error();
    const reader = response.body?.getReader();
    if (!reader) throw new Error();
    const decoder = new TextDecoder();
    let text = "", bytes = 0;
    try {
      while (true) {
        const chunk = await reader.read();
        if (chunk.done) break;
        bytes += chunk.value.byteLength;
        if (bytes > maxBytes) { await reader.cancel(); throw new Error(); }
        text += decoder.decode(chunk.value, { stream: true });
      }
      text += decoder.decode();
    } finally { reader.releaseLock(); }
    return JSON.parse(text);
  } catch {
    throw new Error("Community model unavailable.");
  }
}

const call = z.object({ id: z.string().min(1).max(100), type: z.literal("function"),
  function: z.object({ name: z.string().min(1).max(100), arguments: z.string().max(4000) }) });
const completion = z.object({ choices: z.array(z.object({ finish_reason: z.enum(["stop", "tool_calls"]),
  message: z.object({ content: z.string().nullable().optional(), refusal: z.string().nullable().optional(), tool_calls: z.array(call).max(6).optional() }) })).length(1) });

export async function generateToolCompletion(env: Env, messages: GatewayMessage[], options: { tools?: ToolDefinition[]; maxTokens?: number; temperature?: number }): Promise<ToolCompletionResult> {
  const payload = await runCommunityModel(env, { messages, stream: false, temperature: options.temperature ?? 0,
    max_completion_tokens: options.maxTokens ?? 1200, chat_template_kwargs: { enable_thinking: false },
    ...(options.tools?.length ? { tools: options.tools, tool_choice: "auto" } : {}),
  });
  const parsed = completion.safeParse(payload);
  if (!parsed.success) throw new Error("Community model returned invalid tool requests.");
  const choice = parsed.data.choices[0];
  if (choice.message.refusal) throw new Error("Community model unavailable.");
  const toolCalls = choice.message.tool_calls ?? [];
  if ((choice.finish_reason === "tool_calls") !== (toolCalls.length > 0) || new Set(toolCalls.map(c => c.id)).size !== toolCalls.length) {
    throw new Error("Community model returned invalid tool requests.");
  }
  return { content: choice.message.content ?? null, toolCalls, finishReason: choice.finish_reason };
}
