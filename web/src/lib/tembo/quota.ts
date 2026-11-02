import type { TemboUsage } from "@/lib/platform/contracts";
import { TEMBO_CONFIG } from "./config";

/**
 * Tembo's day (README.md, "Quota") is the calendar day in Africa/Nairobi, where most members are:
 * East Africa Time, UTC+3 all year with no daylight saving, so the allowance resets at 21:00 UTC.
 */
const NAIROBI_OFFSET_MS = 3 * 60 * 60_000;

/** The Nairobi date `now` falls on, as `YYYY-MM-DD`: tembo_usage's day. */
export function temboDay(now: number): string {
  return new Date(now + NAIROBI_OFFSET_MS).toISOString().slice(0, 10);
}

/** The next Nairobi midnight after `now`, in epoch milliseconds: when the allowance resets. */
export function temboDayEnd(now: number): number {
  const local = new Date(now + NAIROBI_OFFSET_MS);
  return Date.UTC(local.getUTCFullYear(), local.getUTCMonth(), local.getUTCDate() + 1) - NAIROBI_OFFSET_MS;
}

export function usageOf(used: number, now: number, limit: number = TEMBO_CONFIG.dailyLimit): TemboUsage {
  return { used: Math.min(Math.max(used, 0), limit), limit, resetsAt: temboDayEnd(now) };
}

/** The caller's questions today: one primary-key read. */
export async function readTemboUsage(db: D1Database, userId: string, now: number): Promise<TemboUsage> {
  const row = await db.prepare("SELECT count FROM tembo_usage WHERE userId = ?1 AND day = ?2")
    .bind(userId, temboDay(now)).first<{ count: number }>();
  return usageOf(row?.count ?? 0, now);
}
