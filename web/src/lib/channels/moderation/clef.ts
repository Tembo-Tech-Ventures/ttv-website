import { createId } from "@paralleldrive/cuid2";
import { CLEF_PROFILE_MODEL, isNoulAnswer, withTimeout } from "@/lib/moderation/clef";
import type { ChannelKind } from "@/lib/platform/contracts";
import { textKey } from "./detectors";
import { mergedReasons } from "./reasons";

/**
 * Clef flash on a channel message (plan §3 "Moderation pipeline", step 2). It runs after the response,
 * through the request's waitUntil, and only for a post or edit that was written: a refused write
 * (permission, code of conduct, rate limit) never reaches the model. Questions adapted from the
 * profile check (src/lib/moderation/clef.ts), and requests are kept out of AI Gateway logs.
 *
 * High-confidence abuse hides the message (HIDDEN, and the author is told). Contact details,
 * promotion and possible abuse flag it (FLAGGED: it stays visible until a person decides, owner
 * decision 2). When Clef fails or times out, the message stays as it is and the failure is logged:
 * the check fails open.
 */

export const CHANNEL_CLEF_TIMEOUT_MS = 8_000;

const LANGUAGES = "Interpret the message in its original language, including English, Swahili, Sheng, French or another language.";
export const CHANNEL_CLEF_QUESTIONS = {
  contact_details: {
    type: "noul",
    instructions: `${LANGUAGES} Does this chat message share a phone number, email address, or messaging-app or social-media handle so people can contact the author outside this platform? Do not count links to code, documents or portfolios.`,
    criteria: {
      true: "The message shares contact details for reaching someone outside the platform.",
      false: "The message shares no such contact details.",
    },
  },
  unrelated_promotion: {
    type: "noul",
    instructions: `${LANGUAGES} Is this message in a learning community's chat mainly promoting an unrelated business, paid service, investment or trading scheme, multi-level marketing, or spam, rather than taking part in the conversation?`,
    criteria: {
      true: "The message is mainly unrelated promotion, an investment scheme or spam.",
      false: "The message takes part in the conversation, including sharing the author's own work or opportunities.",
    },
  },
  abusive: {
    type: "noul",
    instructions: `${LANGUAGES} Does this message harass, threaten, demean or use slurs against a person or group, or contain sexual content?`,
    criteria: {
      true: "The message is abusive, threatening, hateful or sexual.",
      false: "The message is not abusive, even if it disagrees or criticises work.",
    },
  },
} as const;
type Question = keyof typeof CHANNEL_CLEF_QUESTIONS;

/**
 * A score at or above its threshold flags the message; abuse at or above HIDE_THRESHOLD hides it.
 * Initial values, set more cautiously than the profile check's because a channel message is shown at
 * once: flags wait for a person, and only near-certain abuse is hidden without one.
 */
export const CHANNEL_CLEF_THRESHOLDS: Readonly<Record<Question, number>> = Object.freeze({
  contact_details: 0.8, unrelated_promotion: 0.6, abusive: 0.5,
});
export const CHANNEL_CLEF_HIDE_THRESHOLD = 0.9;

/** Plain-language reasons, shown to the author and moderators. */
export const CLEF_REASONS: Readonly<Record<Question, string>> = Object.freeze({
  contact_details: "May share contact details",
  unrelated_promotion: "May be unrelated promotion",
  abusive: "May be abusive",
});

export interface ClefVerdict { hide: boolean; reasons: string[] }
export type ClefFailure = "not_configured" | "timeout" | "invalid_response" | "model_error";

/** A failed check. The message is never part of it, so it is safe to log. */
export class ClefCheckError extends Error {
  constructor(readonly failure: ClefFailure) {
    super(`Channel message check failed: ${failure}`);
  }
}

const KIND_LABEL: Readonly<Record<ChannelKind, string>> = Object.freeze({
  COHORT: "a cohort's chat channel", COMMUNITY: "an open community chat channel", DIRECT: "a direct conversation",
});

/** Asks Clef about one message. Throws ClefCheckError; never returns a partial verdict. */
export async function askClef(
  ai: Pick<Ai, "run"> | undefined, gatewayName: string | undefined,
  message: { body: string; channelKind: ChannelKind }, timeoutMs = CHANNEL_CLEF_TIMEOUT_MS,
): Promise<ClefVerdict> {
  const gateway = gatewayName?.trim();
  if (!ai || !gateway) throw new ClefCheckError("not_configured");
  let response: unknown;
  try {
    response = await withTimeout(ai.run(
      CLEF_PROFILE_MODEL as Parameters<typeof ai.run>[0],
      { model: "clef-flash", state: { message: message.body, where: KIND_LABEL[message.channelKind] }, questions: CHANNEL_CLEF_QUESTIONS } as never,
      // A message can hold the very contact details this check looks for: route through the
      // Gateway without keeping the request or the response in its logs.
      { gateway: { id: gateway, collectLog: false } },
    ) as Promise<unknown>, timeoutMs);
  } catch (error) {
    throw new ClefCheckError(error instanceof Error && error.message === "Clef check timed out" ? "timeout" : "model_error");
  }
  const answers = response && typeof response === "object" ? (response as { answers?: Record<string, unknown> }).answers : undefined;
  const reasons: string[] = [];
  let hide = false;
  for (const question of Object.keys(CHANNEL_CLEF_QUESTIONS) as Question[]) {
    const answer = answers?.[question];
    if (!isNoulAnswer(answer)) throw new ClefCheckError("invalid_response");
    if (answer.noul >= CHANNEL_CLEF_THRESHOLDS[question]) reasons.push(CLEF_REASONS[question]);
    if (question === "abusive" && answer.noul >= CHANNEL_CLEF_HIDE_THRESHOLD) hide = true;
  }
  return { hide, reasons };
}

export interface ClefScreenContext {
  db: D1Database;
  ai?: Pick<Ai, "run">;
  gatewayName?: string;
  timeoutMs?: number;
  now?: () => number;
}

/**
 * What the check did: nothing to check, nothing found, a flag, a hide, or nothing to change (the text
 * changed while Clef answered, or the verdict adds no reason the message lacks).
 */
export type ClefOutcome = "skipped" | "clear" | "flagged" | "hidden" | "unchanged";

/**
 * Screens a message that was just written with `body`, and applies the verdict while the message
 * still has that text. Skipped without asking Clef when the message has changed, been deleted or
 * hidden since, or an admin allowlisted this text. A verdict that adds nothing (reasons it already
 * carries) changes nothing. Throws ClefCheckError when the check fails; the caller logs it.
 */
export async function clefScreen(
  ctx: ClefScreenContext, message: { id: string; channelId: string; channelKind: ChannelKind; body: string },
): Promise<ClefOutcome> {
  const key = await textKey(message.body);
  // ?1 message, ?2 the text that was screened, ?3 its allowlist key.
  const current = `id = ?1 AND body = ?2 AND deletedAt IS NULL AND moderationState <> 'HIDDEN'
    AND NOT EXISTS (SELECT 1 FROM moderation_allowlist WHERE key = ?3)`;
  const open = await ctx.db.prepare(`SELECT 1 AS open FROM channel_message WHERE ${current}`)
    .bind(message.id, message.body, key).first<{ open: number }>();
  if (!open) return "skipped";

  const verdict = await askClef(ctx.ai, ctx.gatewayName, message, ctx.timeoutMs);
  if (!verdict.hide && verdict.reasons.length === 0) return "clear";
  // A hide always has a reason: abuse past the hide threshold is past the flag threshold too.
  const reasons = JSON.stringify(verdict.reasons);
  const now = ctx.now?.() ?? Date.now();
  const eventId = createId();
  // ?4 reasons, ?5 now, ?6 hide, ?7 the event, ?8 channel. The event comes first, so it records the
  // state the verdict found; the update acts only if the event was written.
  const adds = `(?6 OR EXISTS (SELECT 1 FROM json_each(?4) r WHERE r.value NOT IN (SELECT value FROM json_each(moderationReasons))))`;
  const params = [message.id, message.body, key, reasons, now, verdict.hide ? 1 : 0, eventId, message.channelId];
  const [event] = await ctx.db.batch([
    ctx.db.prepare(`INSERT INTO moderation_event (id, messageId, action, source, actorId, fromState, toState, reasons, createdAt)
      SELECT ?7, id, CASE WHEN ?6 THEN 'HIDE' ELSE 'FLAG' END, 'CLEF', NULL, moderationState,
        CASE WHEN ?6 THEN 'HIDDEN' ELSE 'FLAGGED' END, ?4, ?5
      FROM channel_message WHERE ${current} AND ${adds} RETURNING id`).bind(...params.slice(0, 7)),
    ctx.db.prepare(`UPDATE channel_message SET
        moderationState = CASE WHEN ?6 THEN 'HIDDEN' ELSE 'FLAGGED' END,
        moderationReasons = ${mergedReasons("moderationReasons", "?4")},
        hiddenAt = CASE WHEN ?6 THEN ?5 ELSE hiddenAt END,
        changeSeq = (SELECT MAX(changeSeq) + 1 FROM channel_message WHERE channelId = ?8)
      WHERE ${current} AND EXISTS (SELECT 1 FROM moderation_event WHERE id = ?7)`).bind(...params),
  ]);
  if (event?.results.length !== 1) return "unchanged";
  return verdict.hide ? "hidden" : "flagged";
}
