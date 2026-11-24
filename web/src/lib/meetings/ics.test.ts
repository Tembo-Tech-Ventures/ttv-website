import { describe, expect, it } from "vitest";
import { calendarFile, foldLine, icsText, icsTime } from "./ics";
import { nairobiMoment } from "./session-times";

const START = nairobiMoment("2026-11-27", "18:00") as number;
const EVENT = {
  id: "clmeeting0001", title: "Testing payment callbacks", description: "Cohort 04 session on TTV. Join from Sessions: https://ttv.example/dashboard/cohort/sessions",
  url: "https://ttv.example/dashboard/cohort/sessions", startAt: START, minutes: 45, now: Date.parse("2026-11-24T08:00:00.500Z"), sequence: 0,
};

/** Unfolds a file as RFC 5545 §3.1 says (CRLF then one space or tab joins), into [name, params, value] lines. */
function parse(file: string) {
  const unfolded = file.replace(/\r\n[ \t]/g, "");
  return unfolded.split("\r\n").filter(Boolean).map((line) => {
    const colon = line.indexOf(":");
    const [name, ...params] = line.slice(0, colon).split(";");
    return { name, params, value: line.slice(colon + 1) };
  });
}
/** Reads a TEXT value back the way calendar apps do (§3.3.11). */
const unescape = (value: string) => value.replace(/\\([\\;,nN])/g, (_, char: string) => (char === "n" || char === "N" ? "\n" : char));
/** Reads a UTC DATE-TIME (form #2) back to epoch ms, as Google Calendar and Apple Calendar do. */
function utcOf(value: string): number {
  const match = /^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})Z$/.exec(value);
  if (!match) throw new Error(`Not a UTC date-time: ${value}`);
  const [y, mo, d, h, mi, s] = match.slice(1).map(Number);
  return Date.UTC(y, mo - 1, d, h, mi, s);
}

describe("the calendar file (RFC 5545)", () => {
  it("is one VCALENDAR with VERSION and PRODID first, and one VEVENT, every line ending CRLF", () => {
    const file = calendarFile(EVENT);
    expect(file.endsWith("\r\n")).toBe(true);
    expect(file.replace(/\r\n/g, "")).not.toMatch(/[\r\n]/);
    const names = parse(file).map(({ name }) => name);
    expect(names.slice(0, 3)).toEqual(["BEGIN", "VERSION", "PRODID"]);
    expect(names.filter((name) => name === "BEGIN")).toHaveLength(2);
    expect(parse(file).find(({ name }) => name === "VERSION")?.value).toBe("2.0");
    expect(names.at(-1)).toBe("END");
  });

  it("carries the right moment in UTC: 18:00 EAT is 15:00Z, and the end is the booked length later", () => {
    const lines = parse(calendarFile(EVENT));
    const value = (name: string) => lines.find((line) => line.name === name)?.value as string;
    expect(value("DTSTART")).toBe("20261127T150000Z");
    expect(utcOf(value("DTSTART"))).toBe(START);
    expect(utcOf(value("DTEND")) - utcOf(value("DTSTART"))).toBe(45 * 60_000);
    // No TZID, so no VTIMEZONE is needed: each calendar shows the moment in its own zone.
    expect(lines.some(({ params }) => params.some((param) => param.startsWith("TZID")))).toBe(false);
    expect(value("DTSTAMP")).toBe("20261124T080000Z");
  });

  it("has the properties Google Calendar and Apple Calendar require, and a stable UID per call", () => {
    const lines = parse(calendarFile(EVENT));
    const names = new Set(lines.map(({ name }) => name));
    for (const required of ["UID", "DTSTAMP", "DTSTART", "DTEND", "SUMMARY", "SEQUENCE", "STATUS"]) expect(names).toContain(required);
    const uid = lines.find(({ name }) => name === "UID")?.value;
    expect(uid).toBe("clmeeting0001@tembotechventures.com");
    // Adding a moved session again replaces the entry: the same UID, a higher SEQUENCE.
    const moved = parse(calendarFile({ ...EVENT, startAt: START + 86_400_000, sequence: 3 }));
    expect(moved.find(({ name }) => name === "UID")?.value).toBe(uid);
    expect(moved.find(({ name }) => name === "SEQUENCE")?.value).toBe("3");
    expect(parse(calendarFile({ ...EVENT, cancelled: true })).find(({ name }) => name === "STATUS")?.value).toBe("CANCELLED");
  });

  it("escapes commas, semicolons, backslashes and newlines in text, and reads them back unchanged", () => {
    const title = "Webhooks, retries; and C:\\paths\nPart 2";
    expect(icsText(title)).toBe("Webhooks\\, retries\\; and C:\\\\paths\\nPart 2");
    const summary = parse(calendarFile({ ...EVENT, title })).find(({ name }) => name === "SUMMARY")?.value as string;
    expect(unescape(summary)).toBe(title);
  });

  it("folds long lines at 75 octets, never inside a character, and unfolds to the same text", () => {
    const title = "Ushirikiano wa jamii — kujenga programu pamoja na wanachama wote wa kikundi cha 04 ✓✓✓ ".repeat(3).trim();
    const file = calendarFile({ ...EVENT, title });
    const encoder = new TextEncoder();
    for (const line of file.split("\r\n")) expect(encoder.encode(line).length).toBeLessThanOrEqual(75);
    expect(unescape(parse(file).find(({ name }) => name === "SUMMARY")?.value as string)).toBe(title);
    expect(foldLine("A".repeat(75))).toBe("A".repeat(75));
    expect(foldLine("A".repeat(76))).toBe(`${"A".repeat(75)}\r\n A`);
  });

  it("writes whole seconds in the basic UTC form", () => {
    expect(icsTime(Date.parse("2026-01-02T03:04:05.999Z"))).toBe("20260102T030405Z");
  });
});
