import type { Politeness } from "./announcer";

/** A moment worth saying out loud: when `at` seconds are left, once. */
export type CountdownWarning = { at: number; priority: Politeness };

/**
 * A call's warnings: politely at 15 and 5 minutes, at once at 1 minute and at
 * 10 seconds. A call ends at 90 minutes, so the first comes at 75.
 */
export const CALL_WARNINGS: readonly CountdownWarning[] = [
  { at: 15 * 60, priority: "polite" },
  { at: 5 * 60, priority: "polite" },
  { at: 60, priority: "assertive" },
  { at: 10, priority: "assertive" },
];

/** A check-in's warnings: it ends at 30 minutes, so politely at 10 and 5, then as a call's. */
export const CHECK_IN_WARNINGS: readonly CountdownWarning[] = [
  { at: 10 * 60, priority: "polite" },
  { at: 5 * 60, priority: "polite" },
  { at: 60, priority: "assertive" },
  { at: 10, priority: "assertive" },
];

/** How close the end is: said in words and an icon as well as colour. */
export type Urgency = "calm" | "soon" | "now" | "over";

export function urgency(seconds: number): Urgency {
  if (seconds <= 0) return "over";
  if (seconds <= 60) return "now";
  if (seconds <= 5 * 60) return "soon";
  return "calm";
}

/** The steps the last minute moves in: every second, or every ten under reduced motion. */
const lastMinuteStep = (reduced: boolean) => (reduced ? 10 : 1);

/**
 * The time left as shown and as said. Whole minutes, rounded up, while more
 * than a minute is left ("12 min left"), so the number changes once a minute
 * and matches the warnings; then minutes and seconds ("0:42 left"), in steps
 * of ten seconds under reduced motion.
 */
export function timeLeft(seconds: number, reduced = false): { shown: string; spoken: string } {
  if (seconds <= 0) return { shown: "Ending now", spoken: "Ending now" };
  if (seconds > 60) {
    const minutes = Math.ceil(seconds / 60);
    return { shown: `${minutes} min left`, spoken: `${minutes} minutes left` };
  }
  const step = lastMinuteStep(reduced);
  const left = Math.min(60, Math.ceil(seconds / step) * step);
  if (left === 60) return { shown: "1:00 left", spoken: "1 minute left" };
  return { shown: `0:${String(left).padStart(2, "0")} left`, spoken: `${left} ${left === 1 ? "second" : "seconds"} left` };
}

/** "The session ends in 15 minutes." "The call ends in 10 seconds." */
export function warningMessage(at: number, subject: string): string {
  const amount = at >= 60 && at % 60 === 0 ? `${at / 60} ${at === 60 ? "minute" : "minutes"}` : `${at} ${at === 1 ? "second" : "seconds"}`;
  return `${subject} ends in ${amount}.`;
}

/**
 * Milliseconds until the countdown next has something to do: the shown time
 * changes, or a warning falls due. Never less than 50, so it can't spin.
 */
export function nextChange(seconds: number, warnings: readonly CountdownWarning[], reduced = false): number {
  const step = seconds > 60 ? 60 : lastMinuteStep(reduced);
  // The shown value is ceil(seconds / step); it changes when seconds reach the step below it.
  let next = seconds - (Math.ceil(seconds / step) - 1) * step;
  for (const warning of warnings) if (warning.at < seconds) next = Math.min(next, seconds - warning.at);
  return Math.max(50, Math.ceil(next * 1000) + 5);
}

/** How far past a warning a countdown may start, or have its end moved, and still say it. */
export const WARNING_GRACE_SECONDS = 2;

/**
 * Which warnings are spent when the countdown starts or its end moves, `seconds`
 * from the end. One already said stays said, unless the end has moved back
 * before it by more than the grace: then it is armed again, to be said when it
 * comes round. One passed by more than the
 * grace is spent without a word: it is no longer news. One passed by less (a
 * correction from the server that steps over it) stays armed, so the next look
 * says it.
 */
export function armWarnings(seconds: number, warnings: readonly CountdownWarning[], spent: ReadonlySet<number>): Set<number> {
  const next = new Set(spent);
  for (const warning of warnings) {
    // Back above a warning by more than the grace: the end really moved later, so it is news again.
    // Within the grace it is jitter from a correction, and a warning said stays said.
    if (seconds > warning.at + WARNING_GRACE_SECONDS) next.delete(warning.at);
    else if (seconds <= warning.at - WARNING_GRACE_SECONDS) next.add(warning.at);
  }
  return next;
}

/**
 * The warnings crossed since the last look, and which one of them to say. A
 * tab that slept through several says only the latest, the most urgent, and
 * every crossed warning is spent, so each is said at most once. Nothing is said
 * after the end.
 */
export function dueWarning(
  seconds: number,
  warnings: readonly CountdownWarning[],
  spent: ReadonlySet<number>,
): { say: CountdownWarning | null; spend: number[] } {
  const crossed = warnings.filter((warning) => seconds <= warning.at && !spent.has(warning.at));
  if (crossed.length === 0) return { say: null, spend: [] };
  const latest = crossed.reduce((most, warning) => (warning.at < most.at ? warning : most));
  return { say: seconds > 0 ? latest : null, spend: crossed.map((warning) => warning.at) };
}
