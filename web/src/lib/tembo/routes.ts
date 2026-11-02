import { ChannelError } from "@/lib/channels/errors";
import { readMessage, type ReadContext } from "@/lib/channels/messages";
import type { MessageTarget } from "@/lib/channels/mutations";
import type { TemboFeedbackKind, TemboResponse } from "@/lib/platform/contracts";
import { acceptAsk } from "./ask";

/**
 * POST /api/channels/:id/tembo and POST /api/messages/:id/tembo-feedback (README.md beside this file).
 * channels/http.ts admits the caller (both flags, the token scope, same origin) and resolves the
 * channel and the message through channelAccessFor before either runs.
 */

/** A run this request must start after the response. */
export interface TemboRun { messageId: string; claim: string }

const quotaMessage = (limit: number) => `You've asked Tembo ${limit} questions today. You can ask again after midnight, Nairobi time.`;

/**
 * Asks Tembo about one of the caller's own messages in this channel. Idempotent: the first ask is
 * answered after the response (pending, with `run`); asking again returns pending until the answer is
 * posted, then the answer. 403 for someone else's message or a channel the caller can't post in; 409
 * for a deleted or hidden message or a closed thread; 429 quota_exhausted, with the wait until the
 * allowance resets, when no questions are left today.
 */
export async function askTembo(
  ctx: ReadContext & { now?: number }, target: MessageTarget,
): Promise<{ response: TemboResponse; status: 200 | 202; run: TemboRun | null }> {
  if (target.channelId !== ctx.channel.id) throw new ChannelError("not_found", "Message not found.", 404);
  if (target.authorKind !== "USER" || target.authorId !== ctx.viewerId) {
    throw new ChannelError("forbidden", "You can ask Tembo about your own messages only.", 403);
  }
  if (!ctx.channel.capabilities.canPost) throw new ChannelError("forbidden", "You can read this channel but not post in it.", 403);
  const closed = () => new ChannelError("conflict", "This message or its thread is closed, so Tembo can't answer it.", 409);
  if (target.deletedAt !== null || target.moderationState === "HIDDEN") throw closed();

  const now = ctx.now ?? Date.now();
  const outcome = await acceptAsk(ctx.db, { messageId: target.id, channelId: ctx.channel.id, userId: ctx.viewerId, now });
  const pending = { status: "pending", messageId: target.id, usage: outcome.usage } as const;
  switch (outcome.status) {
    case "run": return { response: pending, status: 202, run: { messageId: target.id, claim: outcome.claim } };
    case "pending": return { response: pending, status: 202, run: null };
    case "answered": {
      const message = outcome.answerId === null ? null : await readMessage(ctx, outcome.answerId);
      if (!message) throw new ChannelError("conflict", "Tembo has already answered this question.", 409);
      return { response: { status: "answer", message, usage: outcome.usage }, status: 200, run: null };
    }
    case "quota":
      throw new ChannelError("quota_exhausted", quotaMessage(outcome.usage.limit), 429, Math.max(1, outcome.usage.resetsAt - now));
    case "closed": throw closed();
  }
}

/**
 * "Helpful" or "not quite" on a Tembo answer the caller can see: one per person and answer, the
 * latest choice kept. 404 for anything that is not a Tembo answer; 409 once it is deleted.
 */
export async function giveTemboFeedback(
  ctx: Pick<ReadContext, "db" | "viewerId"> & { now?: number }, target: MessageTarget, kind: TemboFeedbackKind,
): Promise<void> {
  if (target.authorKind !== "TEMBO") throw new ChannelError("not_found", "Tembo answer not found.", 404);
  if (target.deletedAt !== null) throw new ChannelError("conflict", "This answer was removed.", 409);
  const now = ctx.now ?? Date.now();
  await ctx.db.prepare(`INSERT INTO tembo_feedback (messageId, userId, kind, createdAt, updatedAt) VALUES (?1, ?2, ?3, ?4, ?4)
    ON CONFLICT (messageId, userId) DO UPDATE SET kind = excluded.kind, updatedAt = max(tembo_feedback.updatedAt, excluded.updatedAt)`)
    .bind(target.id, ctx.viewerId, kind, now).run();
}
