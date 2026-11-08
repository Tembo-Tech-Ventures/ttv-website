/**
 * One way to write a date on the pages members read: "15 Jan 2027". The day
 * comes first, as most members (and the attention panel) read dates, and the
 * month is a word, so "1/10" can never mean two different days.
 *
 * Calendar dates, such as a cohort's start, are stored as midnight UTC and are
 * read in UTC so they never move by a day. Moments, such as when a message
 * arrived, are read in Nairobi time, where most members are.
 */
const DAY_MONTH_YEAR = { day: "numeric", month: "short", year: "numeric" } as const;

const calendar = new Intl.DateTimeFormat("en-GB", { ...DAY_MONTH_YEAR, timeZone: "UTC" });
const moment = new Intl.DateTimeFormat("en-GB", { ...DAY_MONTH_YEAR, timeZone: "Africa/Nairobi" });
const momentTime = new Intl.DateTimeFormat("en-GB", { hour: "2-digit", minute: "2-digit", hourCycle: "h23", timeZone: "Africa/Nairobi" });

/** A date with no time of day: "6 Oct 2026". */
export function formatCalendarDate(date: Date): string {
  return calendar.format(date);
}

/** The day something happened, in Nairobi time: "6 Oct 2026". */
export function formatMomentDate(date: Date): string {
  return moment.format(date);
}

/** A moment where the hour matters, such as when a credential stops working, in Nairobi time: "6 Oct 2026, 14:05". */
export function formatMomentDateTime(date: Date): string {
  return `${moment.format(date)}, ${momentTime.format(date)}`;
}
