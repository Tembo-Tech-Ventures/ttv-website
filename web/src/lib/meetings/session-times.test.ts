import { describe, expect, it } from "vitest";
import { CALL_LIMIT_MINUTES, SESSION_LENGTH_STEP_MINUTES } from "./rules";
import {
  lengthLabel, nairobiFields, nairobiMoment, SESSION_LENGTHS, sessionDate, sessionDay, sessionHours, weekdayOf, weeklyDates,
} from "./session-times";

const NOW = Date.parse("2026-11-24T08:00:00Z");

describe("cohort session times", () => {
  it("reads a Nairobi date and time as the exact moment, three hours ahead of UTC", () => {
    expect(new Date(nairobiMoment("2026-11-27", "18:00") as number).toISOString()).toBe("2026-11-27T15:00:00.000Z");
    // Just after midnight in Nairobi is the evening before in UTC.
    expect(new Date(nairobiMoment("2027-01-01", "00:30") as number).toISOString()).toBe("2026-12-31T21:30:00.000Z");
  });

  it("refuses a date or time that doesn't exist", () => {
    for (const [date, time] of [["2026-02-30", "18:00"], ["2026-13-01", "18:00"], ["27/11/2026", "18:00"], ["2026-11-27", "24:00"],
      ["2026-11-27", "18:60"], ["2026-11-27", "6pm"], ["", ""]]) {
      expect(nairobiMoment(date, time), `${date} ${time}`).toBeNull();
    }
  });

  it("writes a moment back as the form's fields, in Nairobi time", () => {
    expect(nairobiFields(Date.parse("2026-12-31T21:30:00Z"))).toEqual({ date: "2027-01-01", time: "00:30" });
    const moment = nairobiMoment("2026-11-27", "18:05") as number;
    expect(nairobiFields(moment)).toEqual({ date: "2026-11-27", time: "18:05" });
  });

  it("lists a weekly series as separate dates, a week apart, across a month and a year end", () => {
    expect(weeklyDates("2026-11-26", 6)).toEqual(["2026-11-26", "2026-12-03", "2026-12-10", "2026-12-17", "2026-12-24", "2026-12-31"]);
    expect(weeklyDates("2026-12-31", 2)).toEqual(["2026-12-31", "2027-01-07"]);
    expect(weeklyDates("not a date", 3)).toEqual([]);
    expect(weekdayOf("2026-11-26")).toBe("Thursday");
  });

  it("offers every length up to the call limit, in its steps, and says them in words", () => {
    expect(SESSION_LENGTHS[0]).toBe(SESSION_LENGTH_STEP_MINUTES);
    expect(SESSION_LENGTHS.at(-1)).toBe(CALL_LIMIT_MINUTES);
    expect(SESSION_LENGTHS.every((minutes, index) => index === 0 || minutes - SESSION_LENGTHS[index - 1] === SESSION_LENGTH_STEP_MINUTES)).toBe(true);
    expect([45, 60, 90].map(lengthLabel)).toEqual(["45 minutes", "1 hour", "1 hour 30 minutes"]);
  });

  it("writes a session's day and hours in Nairobi time, with EAT and the year only when it isn't this one", () => {
    const start = nairobiMoment("2026-11-27", "18:00") as number;
    expect(sessionDay(start, NOW)).toBe("Fri 27 Nov");
    expect(sessionHours(start, 45)).toBe("18:00–18:45 EAT");
    expect(sessionDay(nairobiMoment("2027-01-07", "18:00") as number, NOW)).toBe("Thu 7 Jan 2027");
    expect(sessionDate("2026-12-03", NOW)).toBe("Thu 3 Dec");
  });
});
