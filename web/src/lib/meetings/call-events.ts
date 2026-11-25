import { callBookedAttention, callCancelledAttention, callProposedAttention } from "@/lib/attention/call-producers";
import type { FlagContext } from "@/lib/platform/server/flags";
import type { CallEvent } from "./proposals";

/**
 * What a call between two people tells the other person after the response (proposals.ts): their
 * Attention, best effort, through waitUntil where the request has it. Nothing here fails the page.
 */
export function callEvents(
  env: { DB: D1Database } & FlagContext["env"],
  cfContext: Pick<ExecutionContext, "waitUntil"> | undefined,
  now = Date.now(),
): (event: CallEvent) => void {
  const context = { db: env.DB, env };
  return (event) => {
    const work = event.kind === "proposed" ? callProposedAttention(context, event.proposalId, event.countered, now)
      : event.kind === "booked" ? callBookedAttention(context, event.proposalId, event.meetingId, now)
        : callCancelledAttention(context, event.meetingId, event.byUserId, now);
    if (cfContext) cfContext.waitUntil(work);
    else void work;
  };
}
