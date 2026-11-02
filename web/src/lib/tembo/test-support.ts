import type { GatewayMessage } from "@/lib/ai/gateway";
import { channelDatabase, VIEWER, type ChannelFixture } from "@/lib/channels/test-support";
import type { CapabilityCase } from "@/lib/platform/server/capabilities.fixtures";
import type { TemboModel } from "./model";

/** One model reply: tool calls, an answer, or a failure. */
export type Step = { search: (readonly [tool: string, query: string])[] } | { answer: string } | { fail: true };

export interface ModelCall { messages: GatewayMessage[]; tools: string[] }

/**
 * A model that plays `steps` in order (then answers NO_ANSWER), recording what it was given: every
 * message (system prompt, conversation and tool results) and the tools it was offered.
 */
export function scriptedModel(steps: Step[] = []) {
  const calls: ModelCall[] = [];
  const model: TemboModel = async (messages, tools) => {
    calls.push({ messages: structuredClone(messages), tools: tools?.map((tool) => tool.function.name) ?? [] });
    const step = steps[calls.length - 1] ?? { answer: "NO_ANSWER" };
    if ("fail" in step) throw new Error("Synthetic model outage");
    if ("answer" in step) return { content: step.answer, toolCalls: [], finishReason: "stop" };
    return {
      content: null, finishReason: "tool_calls",
      toolCalls: step.search.map(([name, query], i) => ({
        id: `call-${calls.length}-${i}`, type: "function" as const, function: { name, arguments: JSON.stringify({ query }) },
      })),
    };
  };
  /** Everything the model was shown (not what it wrote itself, such as its tool queries), as one text. */
  const seen = () => calls.flatMap((call) => call.messages.flatMap((message) => message.role === "assistant" ? [] : [message.content])).join("\n");
  return { model, calls, seen };
}

/** 09:00 in Nairobi on 2 November 2026: 15 hours before the allowance resets (21:00 UTC). */
export const NOW = Date.parse("2026-11-02T06:00:00Z");

/** A channel fixture where the caller (Wanjiku, cohort A by default) has agreed to the code of conduct. */
export function temboDatabase(fixture: Partial<CapabilityCase> = { applications: [{ programId: "cohort-a", status: "APPROVED" }] }) {
  const s = channelDatabase(fixture);
  s.agree();
  /** The caller's question, written as a post would write it. */
  const question = (slug: string, body = "@tembo what did we decide?", options: Parameters<ChannelFixture["message"]>[1] = {}) =>
    s.message(slug, { author: VIEWER, body, ...options });
  /** Asks Tembo about a message in a channel (by slug, or a channel id). */
  const ask = (slug: string, messageId: string, options: Parameters<ChannelFixture["call"]>[1] = {}) =>
    s.call("askTembo", { id: slug.startsWith("channel:") ? slug.slice(8) : s.channel(slug), body: { messageId }, now: () => NOW, ...options });
  const rows = <T>(sql: string, ...params: (string | number | null)[]) => s.database.prepare(sql).all(...params) as T[];
  const usage = (userId: string = VIEWER) => rows<{ day: string; count: number }>("SELECT day, count FROM tembo_usage WHERE userId = ? ORDER BY day", userId);
  return { ...s, question, ask, rows, usage };
}
export type TemboFixture = ReturnType<typeof temboDatabase>;
