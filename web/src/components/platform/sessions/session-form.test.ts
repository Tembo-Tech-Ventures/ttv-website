import { describe, expect, it } from "vitest";
import { nairobiMoment } from "@/lib/meetings/session-times";
import { previewKeyOf, readSchedule, readSessionEdit } from "./session-form";

const NOW = Date.parse("2026-11-24T08:00:00Z");
const form = (fields: Record<string, string | string[]>) => {
  const data = new FormData();
  for (const [name, value] of Object.entries(fields)) for (const one of [value].flat()) data.append(name, one);
  return data;
};
const SERIES = { cohort: "cohort-a", title: "Testing payment callbacks", date: "2026-11-26", time: "18:00", length: "45", repeat: "weekly", weeks: "6" };

describe("the schedule form", () => {
  it("schedules just once straight away", () => {
    const reading = readSchedule(form({ ...SERIES, repeat: "once", intent: "schedule" }), NOW);
    expect(reading).toMatchObject({ kind: "ready", startTimes: [nairobiMoment("2026-11-26", "18:00")], minutes: 45, skipped: [] });
  });

  it("shows a weekly series first, every date ticked, even when Schedule was pressed", () => {
    const reading = readSchedule(form({ ...SERIES, intent: "schedule" }), NOW);
    expect(reading.kind).toBe("preview");
    if (reading.kind !== "preview") return;
    expect(reading.dates.map(({ date, ticked }) => [date, ticked])).toEqual([
      ["2026-11-26", true], ["2026-12-03", true], ["2026-12-10", true], ["2026-12-17", true], ["2026-12-24", true], ["2026-12-31", true],
    ]);
    expect(reading.dates[0].label).toBe("Thu 26 Nov");
    expect(reading.values.previewKey).toBe(previewKeyOf(SERIES));
  });

  it("schedules the ticked dates of that preview, and names the skipped one", () => {
    const ticked = ["2026-11-26", "2026-12-03", "2026-12-10", "2026-12-24", "2026-12-31"];
    const reading = readSchedule(form({ ...SERIES, intent: "schedule", previewKey: previewKeyOf(SERIES), dates: ticked }), NOW);
    expect(reading).toMatchObject({ kind: "ready", skipped: ["2026-12-17"], minutes: 45 });
    if (reading.kind === "ready") expect(reading.startTimes).toEqual(ticked.map((date) => nairobiMoment(date, "18:00")));
  });

  it("shows the dates again, all ticked, when the series changed after its preview", () => {
    const reading = readSchedule(form({ ...SERIES, time: "17:00", intent: "schedule", previewKey: previewKeyOf(SERIES), dates: ["2026-11-26"] }), NOW);
    expect(reading.kind).toBe("preview");
    if (reading.kind === "preview") expect(reading.dates.every(({ ticked }) => ticked)).toBe(true);
  });

  it("keeps the person's ticks on Update dates, and never schedules a date outside the series", () => {
    const key = previewKeyOf(SERIES);
    const updated = readSchedule(form({ ...SERIES, intent: "preview", previewKey: key, dates: ["2026-11-26", "2026-12-03"] }), NOW);
    expect(updated.kind === "preview" && updated.dates.filter(({ ticked }) => ticked).map(({ date }) => date)).toEqual(["2026-11-26", "2026-12-03"]);
    const forged = readSchedule(form({ ...SERIES, intent: "schedule", previewKey: key, dates: ["2026-11-26", "2027-03-04"] }), NOW);
    expect(forged.kind === "ready" && forged.startTimes).toEqual([nairobiMoment("2026-11-26", "18:00")]);
    const none = readSchedule(form({ ...SERIES, intent: "schedule", previewKey: key }), NOW);
    expect(none).toMatchObject({ kind: "invalid", errors: { dates: "Tick at least one date to schedule." } });
  });

  it("says what to change for each wrong answer", () => {
    const reading = readSchedule(form({ cohort: "", title: "", date: "2026-02-30", time: "6pm", length: "120", repeat: "weekly", weeks: "40" }), NOW);
    expect(reading).toMatchObject({
      kind: "invalid",
      errors: {
        cohort: "Choose a cohort.", title: expect.stringContaining("Enter a title"), date: expect.stringContaining("real date"),
        time: expect.stringContaining("Nairobi time"), length: "Choose a length of up to 90 minutes.", weeks: "Choose 2 to 26 weeks.",
      },
    });
    expect(readSchedule(form({ ...SERIES, date: "2026-11-24", time: "10:00", repeat: "once" }), NOW))
      .toMatchObject({ kind: "invalid", errors: { date: expect.stringContaining("haven't passed") } });
    expect(readSchedule(form({ ...SERIES, date: "2027-11-01", weeks: "6" }), NOW))
      .toMatchObject({ kind: "invalid", errors: { weeks: expect.stringContaining("more than a year ahead") } });
  });
});

describe("the edit form", () => {
  it("reads one date's change, and refuses one in the past", () => {
    expect(readSessionEdit(form({ title: "Moved", date: "2026-12-04", time: "17:00", length: "60" }), NOW))
      .toMatchObject({ kind: "ready", startAt: nairobiMoment("2026-12-04", "17:00"), minutes: 60 });
    expect(readSessionEdit(form({ title: "Moved", date: "2026-11-01", time: "17:00", length: "60" }), NOW)).toMatchObject({ kind: "invalid" });
  });
});
