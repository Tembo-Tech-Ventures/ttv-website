import { describe, expect, it } from "vitest";
import { TEMBO_CONFIG } from "./config";
import { temboDay, temboDayEnd, usageOf } from "./quota";

describe("Tembo's day is the Africa/Nairobi calendar day (UTC+3, no daylight saving)", () => {
  it.each([
    ["2026-11-02T20:59:59.999Z", "2026-11-02", "2026-11-02T21:00:00.000Z"],
    ["2026-11-02T21:00:00.000Z", "2026-11-03", "2026-11-03T21:00:00.000Z"],
    ["2026-11-02T00:00:00.000Z", "2026-11-02", "2026-11-02T21:00:00.000Z"],
    ["2026-12-31T21:00:00.000Z", "2027-01-01", "2027-01-01T21:00:00.000Z"],
    ["2028-02-28T21:30:00.000Z", "2028-02-29", "2028-02-29T21:00:00.000Z"],
    // Nairobi has no daylight saving: northern summer and winter reset at the same UTC hour.
    ["2026-07-01T12:00:00.000Z", "2026-07-01", "2026-07-01T21:00:00.000Z"],
  ])("%s falls on %s, which ends at %s", (at, day, end) => {
    const now = Date.parse(at);
    expect(temboDay(now)).toBe(day);
    expect(new Date(temboDayEnd(now)).toISOString()).toBe(end);
    expect(temboDayEnd(now)).toBeGreaterThan(now);
  });

  it("reports usage within the limit, with the reset time", () => {
    const now = Date.parse("2026-11-02T10:00:00Z");
    expect(usageOf(3, now)).toEqual({ used: 3, limit: TEMBO_CONFIG.dailyLimit, resetsAt: Date.parse("2026-11-02T21:00:00Z") });
    expect(usageOf(99, now).used).toBe(TEMBO_CONFIG.dailyLimit);
    expect(usageOf(-1, now).used).toBe(0);
  });

  it("allows ten questions per person per day, the owner's starting allowance", () => {
    expect(TEMBO_CONFIG.dailyLimit).toBe(10);
  });
});
