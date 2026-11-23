import { APICallError, generateText, stepCountIs, tool, type ToolSet } from "ai";
import { createAI } from "agents/models/ai-sdk";
import { z } from "zod";
import type { GatewayMessage, ToolDefinition } from "../ai/gateway";
import { requireCommunityGateway } from "./native-gateway";

/**
 * Gemma 4, as the rest of the community AI uses, with thinking off as everywhere Gemma runs here.
 * Cloudflare retired the earlier GLM 5.3 Flash on 2026-11-20 (src/lib/ai/retired-models.test.ts).
 */
export const COMMUNITY_CHAT_MODEL = "@cf/google/gemma-4-26b-a4b-it";

const FAILURE_KINDS = new Set(["auth", "rate-limit", "not-found", "bad-request", "provider-error", "gateway-error", "unknown"]);
const ERROR_NAME = /^[A-Za-z_]{1,60}$/;

/**
 * What a failed model call may say in the Worker log: the error's class, the HTTP status, the
 * Workers AI error code (5028 for a retired model) and the provider's failure kind. Never a
 * message, body, request or header, which can hold prompts, evidence and credentials.
 */
export function describeChatFailure(error: unknown) {
  const failure = apiCallError(error);
  const named = failure ?? error;
  const kind = (failure as { code?: unknown } | undefined)?.code;
  const code = workersAICode(failure?.data) ?? bindingCode(failure?.cause);
  return {
    errorName: named instanceof Error && ERROR_NAME.test(named.name) ? named.name : "Error",
    ...(Number.isInteger(failure?.statusCode) ? { status: failure?.statusCode } : {}),
    ...(typeof kind === "string" && FAILURE_KINDS.has(kind) ? { kind } : {}),
    ...(code === undefined ? {} : { code }),
  };
}

/** The provider's API error, which the AI SDK may wrap as a cause. */
function apiCallError(error: unknown): APICallError | undefined {
  let current = error;
  for (let depth = 0; depth < 4 && current instanceof Error; depth++) {
    if (APICallError.isInstance(current)) return current;
    current = current.cause;
  }
  return undefined;
}

/** A thrown binding error leads its message with its code (`"5028: …"`); only that number is read. */
function bindingCode(cause: unknown): number | undefined {
  const match = cause instanceof Error ? /^\s*([35]\d{3})\s*:/.exec(cause.message) : null;
  return match ? Number(match[1]) : undefined;
}

/** The numeric code of a Workers AI binding error (`{ code }`) or error envelope (`{ errors: [{ code }] }`). */
function workersAICode(data: unknown): number | undefined {
  if (!data || typeof data !== "object") return undefined;
  const record = data as Record<string, unknown>;
  const first = (value: unknown) => (Array.isArray(value) ? value[0] : value);
  for (const entry of [record, first(record.errors), first(record.error)]) {
    const code = entry && typeof entry === "object" ? (entry as Record<string, unknown>).code : undefined;
    if (Number.isInteger(code)) return code as number;
  }
  return undefined;
}

/**
 * Request-local tool loop on the AI SDK: no persistence, exporters, provider
 * keys or model fallbacks (docs/community-evidence-assessments.md).
 */
export async function runCommunityAgent(env: Env, messages: GatewayMessage[], definitions: ToolDefinition[], execute: (name: string, args: string) => Promise<string>) {
  requireCommunityGateway(env);
  let steps = 0, calls = 0, executed = 0, limited = false;
  let pending: Promise<unknown> = Promise.resolve();
  const abortSignal = AbortSignal.timeout(60_000);
  // Bound the raw stream before the SDK parses or retains provider output.
  const binding = new Proxy(env.AI, { get(target, key, receiver) {
    if (key !== "run") return Reflect.get(target, key, receiver);
    return async (...args: Parameters<typeof target.run>) => {
      const response = await target.run(...args);
      if (!(response instanceof Response) || !response.body) throw new Error("Invalid chat response.");
      let bytes = 0;
      const body = response.body.pipeThrough(new TransformStream<Uint8Array, Uint8Array>({ transform(chunk, controller) {
        bytes += chunk.byteLength;
        if (bytes > 64_000) throw new Error("Chat response exceeds limit.");
        controller.enqueue(chunk);
      } }));
      return new Response(body, { status: response.status, headers: response.headers });
    };
  } });
  const provider = createAI({ binding, id: env.AI_GATEWAY_NAME.trim(), skipCache: true, collectLog: false,
    requestTimeoutMs: 20_000, retries: { maxAttempts: 1 } });
  const model = provider(COMMUNITY_CHAT_MODEL, { reasoningEffort: null });
  const boundedModel = {
    specificationVersion: model.specificationVersion, provider: model.provider, modelId: model.modelId, supportedUrls: model.supportedUrls,
    doGenerate: (options: Parameters<typeof model.doGenerate>[0]) => {
      abortSignal.throwIfAborted();
      if (++steps > 3) throw new Error("Chat step limit.");
      return model.doGenerate(options);
    },
    doStream: (options: Parameters<typeof model.doStream>[0]) => {
      abortSignal.throwIfAborted();
      if (++steps > 3) throw new Error("Chat step limit.");
      return model.doStream(options);
    },
  };
  const tools: ToolSet = Object.fromEntries(definitions.map(({ function: definition }) => [definition.name, tool({
    description: definition.description,
    inputSchema: z.fromJSONSchema(definition.parameters as z.core.JSONSchema.JSONSchema),
    execute: async args => {
      // The SDK may execute calls concurrently. Reserve synchronously before awaiting.
      if (steps >= 3 || calls >= 6) { limited = true; return { error: "Tool limit reached. Do not infer missing evidence." }; }
      const serialized = JSON.stringify(args);
      if (serialized.length > 4000) return { error: "Tool input exceeds limit." };
      calls++;
      const result = pending.then(() => {
        if (abortSignal.aborted) throw new Error("Chat cancelled.");
        executed++;
        return execute(definition.name, serialized);
      });
      pending = result.catch(() => undefined);
      return result;
    },
  })]));
  try {
    const result = await generateText({
      model: boundedModel, system: messages[0].content ?? "", tools,
      messages: messages.slice(1).map(message => ({ role: "user" as const, content: message.content ?? "" })),
      stopWhen: stepCountIs(3), abortSignal, maxOutputTokens: 1200, temperature: 0, maxRetries: 0,
      timeout: { stepMs: 20_000, totalMs: 60_000 },
    });
    return { content: result.finishReason === "stop" ? result.text : null, limited: limited || result.finishReason !== "stop",
      execution: { model: COMMUNITY_CHAT_MODEL, modelSteps: steps, executedToolCalls: executed } };
  } catch (error) {
    // A run cancelled by its 60s total deadline is limited, not failed: it yields no answer.
    // A single step that times out (20s) aborts only that call, and fails like any provider error.
    if (abortSignal.aborted) return { content: null, limited: true, execution: { model: COMMUNITY_CHAT_MODEL, modelSteps: steps, executedToolCalls: executed } };
    throw chatUnavailable(error, { model: COMMUNITY_CHAT_MODEL, modelSteps: steps, executedToolCalls: executed });
  }
}

/**
 * Logs a failed run and returns the error its caller sees. SDK errors can retain prompts, tool
 * results, response bodies and credentials, so neither carries the original: the log has only
 * describeChatFailure's fields, and the caller a generic message.
 */
function chatUnavailable(error: unknown, execution: { model: string; modelSteps: number; executedToolCalls: number }) {
  console.error({ message: "Community chat model call failed.", event: "community_chat.model_failed", ...execution, ...describeChatFailure(error) });
  return new Error("Community chat unavailable.");
}
