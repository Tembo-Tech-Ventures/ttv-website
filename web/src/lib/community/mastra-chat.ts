import { Agent } from "@mastra/core/agent";
import { noopLogger } from "@mastra/core/logger";
import { createTool } from "@mastra/core/tools";
import { createAI } from "agents/models/ai-sdk";
import { z } from "zod";
import type { GatewayMessage, ToolDefinition } from "../ai/gateway";
import { requireCommunityGateway } from "./native-gateway";

export const COMMUNITY_CHAT_MODEL = "@cf/zai-org/glm-5.3-flash";

/** Request-local agent: no persistence, exporters, provider keys or model fallbacks. */
export async function runCommunityAgent(env: Env, messages: GatewayMessage[], definitions: ToolDefinition[], execute: (name: string, args: string) => Promise<string>) {
  requireCommunityGateway(env);
  let steps = 0, calls = 0, limited = false;
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
  const model = provider(COMMUNITY_CHAT_MODEL, { reasoningEffort: "low" });
  const boundedModel = {
    specificationVersion: model.specificationVersion, provider: model.provider, modelId: model.modelId, supportedUrls: model.supportedUrls,
    doGenerate: (options: Parameters<typeof model.doGenerate>[0]) => {
      if (++steps > 3) throw new Error("Chat step limit.");
      return model.doGenerate(options);
    },
    doStream: (options: Parameters<typeof model.doStream>[0]) => {
      if (++steps > 3) throw new Error("Chat step limit.");
      return model.doStream(options);
    },
  };
  const tools = Object.fromEntries(definitions.map(({ function: definition }) => [definition.name, createTool({
    id: definition.name, description: definition.description,
    inputSchema: z.fromJSONSchema(definition.parameters as z.core.JSONSchema.JSONSchema),
    execute: async args => {
      // Mastra may execute calls concurrently. Reserve synchronously before awaiting.
      if (steps >= 3 || calls >= 6) { limited = true; return { error: "Tool limit reached. Do not infer missing evidence." }; }
      const serialized = JSON.stringify(args);
      if (serialized.length > 4000) return { error: "Tool input exceeds limit." };
      calls++;
      const result = pending.then(() => {
        if (abortSignal.aborted) throw new Error("Chat cancelled.");
        return execute(definition.name, serialized);
      });
      pending = result.catch(() => undefined);
      return result;
    },
  })]));
  const agent = new Agent({ id: "community-chat", name: "Community evidence chat", instructions: messages[0].content ?? "", model: boundedModel, tools });
  agent.__setLogger(noopLogger);
  try {
    const result = await agent.generate(messages.slice(1).map(message => ({ role: "user" as const, content: message.content ?? "" })), {
      maxSteps: 3, maxProcessorRetries: 0, abortSignal,
      modelSettings: { maxOutputTokens: 1200, temperature: 0, maxRetries: 0, timeout: { stepMs: 20_000, totalMs: 60_000 } },
    });
    return { content: result.finishReason === "stop" ? result.text : null, limited: limited || result.finishReason !== "stop" };
  } catch {
    // SDK errors can retain prompts, tool results, response bodies and credentials.
    throw new Error("Community chat unavailable.");
  }
}
