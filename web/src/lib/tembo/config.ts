import { TEMBO_DAILY_LIMIT } from "@/lib/platform/server/me-config";

/**
 * Tembo in channels: the allowance and the bounds on one answer (README.md beside this file). The
 * daily allowance is the owner's decision (10 questions per person per day, 2026-10-31), kept in
 * me-config so /me and the quota can never disagree.
 */
export const TEMBO_CONFIG = Object.freeze({
  /** Accepted questions per person per Africa/Nairobi day. */
  dailyLimit: TEMBO_DAILY_LIMIT,
  /** A run that has not answered after this long is presumed dead, and a new ask may claim it. */
  staleClaimMs: 120_000,
  /** Model calls per answer: tool rounds, then one last call without tools. */
  maxRounds: 3,
  /** No new model call starts this long after the run began: work after a response has about 30 seconds. */
  roundDeadlineMs: 9_000,
  /** Tool calls carried out per round; the rest are answered with an error. */
  toolCallsPerRound: 4,
  /** Results one tool call returns. */
  resultsPerTool: 6,
  /** Sources one answer may draw on, in total. */
  maxSources: 30,
  /** Characters of one source given to the model. */
  sourceChars: 700,
  /** Earlier messages given with the question: the thread's latest replies, or the channel's latest messages. */
  contextMessages: 8,
  /** Session recordings searched, newest first. */
  recordings: 60,
  /** Recent messages searched for shared projects. */
  sharedProjectMessages: 500,
  maxTokens: 700,
  /** The longest answer posted; a longer one is cut at its last whole sentence. */
  answerChars: 2_000,
});
