import { describe, expect, it } from "vitest";
import { blankSuggestion, readSuggestion } from "./call-form";

/* The suggest form's reading (in-app calls P10), as a browser without script posts it. Now is Tue 24 Nov 2026, 11:00 in Nairobi. */
const NOW = Date.parse("2026-11-24T08:00:00Z");
const form = (fields: Record<string, string>) => {
  const data = new FormData();
  for (const [name, value] of Object.entries(fields)) data.set(name, value);
  return data;
};
const base = { token: "token", conversation: "conversation", purpose: "CALL", length: "30" };

describe("reading the suggest form", () => {
  it("reads up to three times in Nairobi time by default, soonest first, skipping empty slots", () => {
    const reading = readSuggestion(form({ ...base, date1: "2026-11-26", time1: "17:00", date3: "2026-11-25", time3: "09:30" }), NOW);
    expect(reading).toMatchObject({ kind: "ready", minutes: 30, review: false,
      times: [Date.parse("2026-11-25T06:30:00Z"), Date.parse("2026-11-26T14:00:00Z")] });
  });

  it("reads the times in the suggester's own time zone when the browser gave one", () => {
    const reading = readSuggestion(form({ ...base, zone: "Europe/Paris", date1: "2026-11-26", time1: "17:00" }), NOW);
    expect(reading).toMatchObject({ kind: "ready", times: [Date.parse("2026-11-26T16:00:00Z")] });
    expect(readSuggestion(form({ ...base, zone: "Not/AZone", date1: "2026-11-26", time1: "17:00" }), NOW))
      .toMatchObject({ kind: "invalid", errors: { zone: "Choose the time zone the times are in." } });
  });

  it("says what to change next to each field", () => {
    const reading = readSuggestion(form({
      ...base, purpose: "CHECKIN", date1: "2026-11-23", time1: "10:00", date2: "2026-11-26", date3: "2026-11-26", time3: "17:00",
    }), NOW);
    expect(reading).toMatchObject({ kind: "invalid", errors: {
      work: "Choose the work this check-in is about.",
      date1: "Choose a time that hasn't passed yet.",
      time2: "Enter a start time, like 17:00.",
    } });
    expect(readSuggestion(form(base), NOW)).toMatchObject({ kind: "invalid", errors: { date1: "Suggest at least one time." } });
    expect(readSuggestion(form({ ...base, length: "100", date1: "2026-11-26", time1: "17:00" }), NOW))
      .toMatchObject({ kind: "invalid", errors: { length: "Choose a length of up to 90 minutes." } });
    expect(readSuggestion(form({ ...base, date1: "2026-11-26", time1: "17:00", date2: "2026-11-26", time2: "17:00" }), NOW))
      .toMatchObject({ kind: "invalid", errors: { date2: "This is the same time as one above. Choose another, or leave it empty." } });
    expect(readSuggestion(form({ ...base, date1: "2027-06-01", time1: "17:00" }), NOW))
      .toMatchObject({ kind: "invalid", errors: { date1: "Calls can be suggested up to 90 days ahead." } });
  });

  it("asks a round of new times for a booked call to be reviewed before it is sent", () => {
    expect(readSuggestion(form({ ...base, change: "booked", intent: "review", date1: "2026-11-26", time1: "17:00" }), NOW))
      .toMatchObject({ kind: "ready", review: true, values: { change: "booked" } });
  });

  it("starts blank in Nairobi time, with no time filled in and recording not asked", () => {
    expect(blankSuggestion("token", "conversation")).toMatchObject({ zone: "Africa/Nairobi", dates: ["", "", ""], clocks: ["", "", ""], record: false, length: "30" });
  });
});
