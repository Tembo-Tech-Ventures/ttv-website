import { SESSION_LENGTH_STEP_MINUTES, CALL_LIMIT_MINUTES } from "./rules";

/**
 * Cohort session times (README.md beside this file, "Scheduling cohort sessions"). Times are entered
 * in Nairobi time, where most members are, and stored as the exact moment (epoch milliseconds). Pages
 * write them in Nairobi time with "EAT" beside them; the browser adds the reader's own time where it
 * differs (`data-local-time`), and the calendar file carries the moment itself, so calendars show it
 * in local time on their own.
 */

export const SESSION_TIME_ZONE = "Africa/Nairobi";
export const SESSION_ZONE_LABEL = "EAT";
const MINUTE_MS = 60_000;
const DAY_MS = 24 * 60 * MINUTE_MS;

/** The lengths a session can be booked for: every step up to the call limit, in minutes. */
export const SESSION_LENGTHS: readonly number[] = Array.from(
  { length: Math.floor(CALL_LIMIT_MINUTES / SESSION_LENGTH_STEP_MINUTES) },
  (_, index) => (index + 1) * SESSION_LENGTH_STEP_MINUTES,
);

const DATE = /^(\d{4})-(\d{2})-(\d{2})$/;
const TIME = /^(\d{2}):(\d{2})$/;

const wallFormats = new Map<string, Intl.DateTimeFormat>();
/** The wall-clock parts of one time zone, made once per zone. */
function wallParts(timeZone: string): Intl.DateTimeFormat {
  let format = wallFormats.get(timeZone);
  if (!format) {
    format = new Intl.DateTimeFormat("en-GB", {
      timeZone, year: "numeric", month: "2-digit", day: "2-digit",
      hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23",
    });
    wallFormats.set(timeZone, format);
  }
  return format;
}

/** The wall clock in `timeZone` (Nairobi's by default) at `ms`, written as if it were UTC. */
function wallClock(ms: number, timeZone = SESSION_TIME_ZONE): number {
  const parts = Object.fromEntries(wallParts(timeZone).formatToParts(new Date(ms)).map(({ type, value }) => [type, Number(value)]));
  return Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute, parts.second);
}

/** Whether `zone` is a time zone this runtime knows ("Africa/Nairobi", "Europe/Paris"), so times can be entered in it. */
export function isTimeZone(zone: string): boolean {
  if (zone.length === 0 || zone.length > 64) return false;
  try {
    wallParts(zone);
    return true;
  } catch {
    return false;
  }
}

/** A calendar date ("2026-11-27") as midnight UTC, or null when it is not a real date. */
function calendarDay(date: string): number | null {
  const match = DATE.exec(date);
  if (!match) return null;
  const [year, month, day] = match.slice(1).map(Number);
  const ms = Date.UTC(year, month - 1, day);
  const back = new Date(ms);
  return back.getUTCFullYear() === year && back.getUTCMonth() === month - 1 && back.getUTCDate() === day ? ms : null;
}

/**
 * The moment a Nairobi date and time name ("2026-11-27", "18:00"), or null when either is not real.
 * Kenya keeps one offset all year, but the zone database decides, so a change there is followed.
 */
export function nairobiMoment(date: string, time: string): number | null {
  return zonedMoment(date, time, SESSION_TIME_ZONE);
}

/**
 * The moment a date and time on the wall clocks of `timeZone` name, or null when either is not real
 * there (a time a daylight-saving change skips included). A call between two people is entered in
 * the suggester's own zone, Nairobi's by default.
 */
export function zonedMoment(date: string, time: string, timeZone: string): number | null {
  const day = calendarDay(date);
  const clock = TIME.exec(time);
  if (day === null || !clock || !isTimeZone(timeZone)) return null;
  const [hour, minute] = clock.slice(1).map(Number);
  if (hour > 23 || minute > 59) return null;
  const wall = day + (hour * 60 + minute) * MINUTE_MS;
  let guess = wall - (wallClock(wall, timeZone) - wall);
  guess = wall - (wallClock(guess, timeZone) - guess);
  return wallClock(guess, timeZone) === wall ? guess : null;
}

/** A moment's Nairobi date and time, as the form's fields take them: { date: "2026-11-27", time: "18:00" }. */
export function nairobiFields(ms: number): { date: string; time: string } {
  return zonedFields(ms, SESSION_TIME_ZONE);
}

/** A moment's date and time on the wall clocks of `timeZone`, as the form's fields take them. */
export function zonedFields(ms: number, timeZone: string): { date: string; time: string } {
  const iso = new Date(wallClock(ms, timeZone)).toISOString();
  return { date: iso.slice(0, 10), time: iso.slice(11, 16) };
}

/** The dates of a weekly series: the first and then every 7 days, `weeks` dates in all. */
export function weeklyDates(first: string, weeks: number): string[] {
  const start = calendarDay(first);
  if (start === null || weeks < 1) return [];
  return Array.from({ length: weeks }, (_, week) => new Date(start + week * 7 * DAY_MS).toISOString().slice(0, 10));
}

const weekday = new Intl.DateTimeFormat("en-GB", { weekday: "long", timeZone: "UTC" });
const shortDay = new Intl.DateTimeFormat("en-GB", { weekday: "short", day: "numeric", month: "short", timeZone: SESSION_TIME_ZONE });
const shortDayYear = new Intl.DateTimeFormat("en-GB", { weekday: "short", day: "numeric", month: "short", year: "numeric", timeZone: SESSION_TIME_ZONE });
const dayMonth = new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", timeZone: SESSION_TIME_ZONE });
const dayNumber = new Intl.DateTimeFormat("en-GB", { day: "numeric", timeZone: SESSION_TIME_ZONE });
const weekdayShort = new Intl.DateTimeFormat("en-GB", { weekday: "short", timeZone: SESSION_TIME_ZONE });
const monthShort = new Intl.DateTimeFormat("en-GB", { month: "short", timeZone: SESSION_TIME_ZONE });
const clockTime = new Intl.DateTimeFormat("en-GB", { hour: "2-digit", minute: "2-digit", hourCycle: "h23", timeZone: SESSION_TIME_ZONE });
const yearOf = new Intl.DateTimeFormat("en-GB", { year: "numeric", timeZone: SESSION_TIME_ZONE });

/** The weekday of a calendar date: "Thursday". */
export function weekdayOf(date: string): string {
  const day = calendarDay(date);
  return day === null ? "" : weekday.format(day);
}

/** A session's day, in Nairobi time: "Thu 27 Nov", with the year when it is not this year's. */
export function sessionDay(ms: number, now: number): string {
  return (yearOf.format(ms) === yearOf.format(now) ? shortDay : shortDayYear).format(ms).replace(",", "");
}

/** A calendar date as a session's day: "Thu 27 Nov". */
export function sessionDate(date: string, now: number): string {
  const ms = nairobiMoment(date, "12:00");
  return ms === null ? date : sessionDay(ms, now);
}

const dayMonthYear = new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: SESSION_TIME_ZONE });
/** A day and month, in Nairobi time: "27 Nov", with the year when it is not this year's: "7 Jan 2027". */
export const shortDate = (ms: number, now: number) => (yearOf.format(ms) === yearOf.format(now) ? dayMonth : dayMonthYear).format(ms);
/** The parts of a session's date block: { day: "27", weekday: "Thu", month: "Nov" }. */
export const dateBlock = (ms: number) => ({ day: dayNumber.format(ms), weekday: weekdayShort.format(ms), month: monthShort.format(ms) });
/** A Nairobi clock time: "18:00". */
export const sessionClock = (ms: number) => clockTime.format(ms);

/** When a session runs, in Nairobi time: "18:00–18:45 EAT". */
export function sessionHours(startAt: number, minutes: number): string {
  return `${sessionClock(startAt)}–${sessionClock(startAt + minutes * MINUTE_MS)} ${SESSION_ZONE_LABEL}`;
}

/** A length in words: "45 minutes", "1 hour", "1 hour 30 minutes". */
export function lengthLabel(minutes: number): string {
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  const parts = [hours > 0 ? `${hours} hour${hours === 1 ? "" : "s"}` : "", rest > 0 ? `${rest} minutes` : ""];
  return parts.filter(Boolean).join(" ");
}

/** A title on one line: control characters and runs of white space become one space (a session's note is one line). */
export function cleanTitle(title: string): string {
  const oneLine = [...title].map((char) => {
    const code = char.codePointAt(0) ?? 0;
    return code < 0x20 || code === 0x7f || code === 0x2028 || code === 0x2029 ? " " : char;
  }).join("");
  return oneLine.replace(/\s+/g, " ").trim();
}
