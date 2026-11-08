import { describe, expect, it } from "vitest";
import { formatCalendarDate, formatMomentDate, formatMomentDateTime } from "./display-date";

describe("display dates", () => {
  it("writes the day, the month as a word, then the year", () => {
    expect(formatCalendarDate(new Date("2027-01-15T00:00:00Z"))).toBe("15 Jan 2027");
    expect(formatMomentDate(new Date("2026-10-13T09:30:00Z"))).toBe("13 Oct 2026");
  });

  it("never moves a calendar date stored as midnight UTC", () => {
    expect(formatCalendarDate(new Date("2026-10-06T00:00:00Z"))).toBe("6 Oct 2026");
    expect(formatCalendarDate(new Date("2026-12-31T23:59:59Z"))).toBe("31 Dec 2026");
  });

  it("reads a moment in Nairobi time, where most members are", () => {
    // 22:30 UTC on 31 October is already 1 November in Nairobi (UTC+3).
    expect(formatMomentDate(new Date("2026-10-31T22:30:00Z"))).toBe("1 Nov 2026");
  });

  it("adds the hour and minute, on a 24-hour clock in Nairobi time, where the hour matters", () => {
    expect(formatMomentDateTime(new Date("2026-10-06T11:05:00Z"))).toBe("6 Oct 2026, 14:05");
    expect(formatMomentDateTime(new Date("2026-10-31T21:00:00Z"))).toBe("1 Nov 2026, 00:00");
  });
});
