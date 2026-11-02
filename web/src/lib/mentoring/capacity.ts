import type { MentorCapacity } from "@/lib/platform/contracts";

/**
 * A mentor's month (README.md beside this file, "Capacity") is the calendar month in Africa/Nairobi:
 * East Africa Time, UTC+3 all year with no daylight saving, as Tembo's day is (src/lib/tembo/quota.ts).
 */
const NAIROBI_OFFSET_MS = 3 * 60 * 60_000;

/** When the Nairobi month `now` falls in began, in epoch milliseconds. */
export function monthStart(now: number): number {
  const local = new Date(now + NAIROBI_OFFSET_MS);
  return Date.UTC(local.getUTCFullYear(), local.getUTCMonth(), 1) - NAIROBI_OFFSET_MS;
}

/** When the next Nairobi month begins after `now`, in epoch milliseconds. */
export function nextMonthStart(now: number): number {
  const local = new Date(now + NAIROBI_OFFSET_MS);
  return Date.UTC(local.getUTCFullYear(), local.getUTCMonth() + 1, 1) - NAIROBI_OFFSET_MS;
}

/**
 * The spots a mentor's requests hold, as two SQL columns over a mentor id expression: PENDING requests
 * (whenever they were made) and requests ACCEPTED since `since`, the month's start (a SQL parameter).
 * Both read mentor_request_mentor_status_idx.
 */
export const spotColumns = (mentorId: string, since: string) => `
  (SELECT COUNT(*) FROM mentor_request s WHERE s.mentorId = ${mentorId} AND s.status = 'PENDING') AS pendingCount,
  (SELECT COUNT(*) FROM mentor_request s WHERE s.mentorId = ${mentorId} AND s.status = 'ACCEPTED' AND s.acceptedAt >= ${since}) AS acceptedCount`;

/** Whether a new request fits, in SQL over the same two index ranges: a spot is free this month. */
export const hasSpot = (mentorId: string, since: string, limit: string) => `(
  (SELECT COUNT(*) FROM mentor_request s WHERE s.mentorId = ${mentorId} AND s.status = 'PENDING')
  + (SELECT COUNT(*) FROM mentor_request s WHERE s.mentorId = ${mentorId} AND s.status = 'ACCEPTED' AND s.acceptedAt >= ${since})
  < ${limit})`;

/**
 * What a mentor has left this month. Each PENDING request and each request accepted this month holds
 * a spot. When none is free, the next opening is the next month's start if the turn of the month
 * frees one (the pending requests alone leave room), and unknown otherwise: it waits on the mentor.
 */
export function capacityOf({ limit, pending, accepted }: { limit: number; pending: number; accepted: number }, now: number): MentorCapacity {
  const used = pending + accepted;
  const full = used >= limit;
  return { used, limit, nextOpeningAt: full && pending < limit ? nextMonthStart(now) : null };
}

/** Whether a spot is open now. */
export const hasOpening = (capacity: MentorCapacity) => capacity.used < capacity.limit;
