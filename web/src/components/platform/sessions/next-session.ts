import { upcomingSessions, type UpcomingSession } from "@/lib/meetings/sessions";
import type { PlatformCapabilities } from "@/lib/platform/server/capabilities";
import { requestScoped } from "@/lib/platform/server/request-scope";

/**
 * The cohort Overview's next session (in-app calls P9, NextSession.astro): the live one, or else the
 * next to come, in the reader's cohorts; null while `meetings` is off for them. Shared for the request
 * (request-scope.ts), so the frame can start it beside the space context (startSpacePageFrame) and the
 * page gets that same read rather than a round trip after it.
 */
export function nextCohortSession(
  db: D1Database, userId: string, capabilities: PlatformCapabilities, meetings: boolean, now: number,
): Promise<UpcomingSession | null> {
  if (!meetings) return Promise.resolve(null);
  return requestScoped(`next-session:${userId}`, async () => {
    const sessions = await upcomingSessions(db, capabilities, now);
    return sessions.find(({ state }) => state === "LIVE") ?? sessions[0] ?? null;
  });
}
