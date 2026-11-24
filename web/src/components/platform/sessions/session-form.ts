import { CALL_LIMIT_MINUTES, SESSION_BOOK_AHEAD_DAYS, SESSION_SERIES_MAX_WEEKS } from "@/lib/meetings/rules";
import { nairobiMoment, SESSION_LENGTHS, sessionDate, weeklyDates } from "@/lib/meetings/session-times";

/**
 * The schedule and edit forms' fields, read and checked on the server (they post without
 * JavaScript). A weekly series is previewed before it is scheduled: the page lists every date, ticked,
 * and a date unticked is skipped. The preview is tied to the fields it was made from (`previewKey`),
 * so a series whose first date, time, length or weeks changed after the preview is shown again rather
 * than scheduled with dates nobody saw. scheduleSessions and changeSession check everything again.
 */

export const REPEATS = ["once", "weekly"] as const;
export type Repeat = (typeof REPEATS)[number];
/** The fewest weeks a weekly series covers: one week is "just once". */
export const MIN_SERIES_WEEKS = 2;
export const DEFAULT_LENGTH = 60;
export const DEFAULT_WEEKS = 6;
const DAY_MS = 24 * 60 * 60_000;

export interface SessionFields {
  title: string;
  date: string;
  time: string;
  length: string;
}

export interface ScheduleValues extends SessionFields {
  cohort: string;
  repeat: Repeat;
  weeks: string;
  /** The dates ticked in the preview. */
  dates: string[];
  previewKey: string;
}

export type FieldErrors<K extends string> = Partial<Record<K, string>>;
export type ScheduleField = keyof ScheduleValues;

export interface PreviewDate {
  date: string;
  label: string;
  ticked: boolean;
}

export type ScheduleReading =
  | { kind: "invalid"; values: ScheduleValues; errors: FieldErrors<ScheduleField> }
  /** A series to look at first: every date, ticked as the person left them (all of them the first time). */
  | { kind: "preview"; values: ScheduleValues; dates: PreviewDate[] }
  | { kind: "ready"; values: ScheduleValues; startTimes: number[]; minutes: number; skipped: string[] };

const text = (form: FormData, name: string) => {
  const value = form.get(name);
  return typeof value === "string" ? value.trim() : "";
};

/** The fields as the form showed them, for a blank form. */
export function blankSchedule(cohort: string): ScheduleValues {
  return { cohort, title: "", date: "", time: "", length: String(DEFAULT_LENGTH), repeat: "once", weeks: String(DEFAULT_WEEKS), dates: [], previewKey: "" };
}

/** What a preview was made from; a series is scheduled only from a preview of these same fields. */
export function previewKeyOf(values: Pick<ScheduleValues, "date" | "time" | "length" | "weeks">): string {
  return [values.date, values.time, values.length, values.weeks].join("|");
}

/** The title, first date, time and length: shared by the schedule and edit forms. */
export function checkSessionFields(values: SessionFields, now: number): { errors: FieldErrors<keyof SessionFields>; startAt: number | null; minutes: number } {
  const errors: FieldErrors<keyof SessionFields> = {};
  if (!values.title) errors.title = "Enter a title, like “Testing payment callbacks”.";
  else if (values.title.length > 120) errors.title = "Keep the title to 120 characters or fewer.";
  const minutes = Number(values.length);
  if (!SESSION_LENGTHS.includes(minutes)) errors.length = `Choose a length of up to ${CALL_LIMIT_MINUTES} minutes.`;
  let startAt: number | null = null;
  if (!values.date) errors.date = "Choose a date.";
  else if (nairobiMoment(values.date, "00:00") === null) errors.date = "Enter a real date, like 2026-11-27.";
  if (!values.time) errors.time = "Enter a start time in Nairobi time, like 18:00.";
  else if (nairobiMoment("2026-01-01", values.time) === null) errors.time = "Enter a start time in Nairobi time, like 18:00.";
  if (!errors.date && !errors.time) {
    startAt = nairobiMoment(values.date, values.time);
    if (startAt === null || startAt <= now) errors.date = "Choose a date and time that haven't passed yet.";
    else if (startAt > now + SESSION_BOOK_AHEAD_DAYS * DAY_MS) errors.date = "Sessions can be booked up to a year ahead.";
  }
  return { errors, startAt: Object.keys(errors).length === 0 ? startAt : null, minutes };
}

/**
 * Reads the schedule form. `intent` is "preview" (show the dates) or "schedule". Just once schedules
 * straight away; a weekly series is scheduled only from a preview of the same fields.
 */
export function readSchedule(form: FormData, now: number): ScheduleReading {
  const repeat = REPEATS.find((value) => value === text(form, "repeat")) ?? "once";
  const values: ScheduleValues = {
    cohort: text(form, "cohort"), title: text(form, "title"), date: text(form, "date"), time: text(form, "time"),
    length: text(form, "length"), repeat, weeks: text(form, "weeks") || String(DEFAULT_WEEKS),
    dates: form.getAll("dates").filter((value): value is string => typeof value === "string"),
    previewKey: text(form, "previewKey"),
  };
  const checked = checkSessionFields(values, now);
  const errors: FieldErrors<ScheduleField> = { ...checked.errors };
  if (!values.cohort) errors.cohort = "Choose a cohort.";
  if (form.get("repeat") !== null && !REPEATS.some((value) => value === form.get("repeat"))) errors.repeat = "Choose just once or every week.";
  const weeks = Number(values.weeks);
  const weekly = repeat === "weekly";
  if (weekly && !(Number.isInteger(weeks) && weeks >= MIN_SERIES_WEEKS && weeks <= SESSION_SERIES_MAX_WEEKS)) {
    errors.weeks = `Choose ${MIN_SERIES_WEEKS} to ${SESSION_SERIES_MAX_WEEKS} weeks.`;
  }
  if (Object.keys(errors).length > 0 || checked.startAt === null) return { kind: "invalid", values, errors };

  if (!weekly) return { kind: "ready", values, startTimes: [checked.startAt], minutes: checked.minutes, skipped: [] };

  const series = weeklyDates(values.date, weeks);
  const last = nairobiMoment(series.at(-1) as string, values.time);
  if (last === null || last > now + SESSION_BOOK_AHEAD_DAYS * DAY_MS) {
    return { kind: "invalid", values, errors: { weeks: "The last date would be more than a year ahead. Choose fewer weeks." } };
  }
  const key = previewKeyOf(values);
  const fresh = values.previewKey !== key;
  const ticked = new Set(fresh ? series : values.dates);
  const dates = series.map((date) => ({ date, label: sessionDate(date, now), ticked: ticked.has(date) }));
  if (fresh || text(form, "intent") !== "schedule") {
    return { kind: "preview", values: { ...values, previewKey: key, dates: series.filter((date) => ticked.has(date)) }, dates };
  }
  const chosen = series.filter((date) => ticked.has(date));
  if (chosen.length === 0) {
    return { kind: "invalid", values: { ...values, dates: [] }, errors: { dates: "Tick at least one date to schedule." } };
  }
  const startTimes = chosen.map((date) => nairobiMoment(date, values.time) as number);
  return { kind: "ready", values, startTimes, minutes: checked.minutes, skipped: series.filter((date) => !ticked.has(date)) };
}

/** Reads the edit form: one date's title, date, time and length. */
export function readSessionEdit(form: FormData, now: number):
  | { kind: "invalid"; values: SessionFields; errors: FieldErrors<keyof SessionFields> }
  | { kind: "ready"; values: SessionFields; startAt: number; minutes: number } {
  const values: SessionFields = { title: text(form, "title"), date: text(form, "date"), time: text(form, "time"), length: text(form, "length") };
  const { errors, startAt, minutes } = checkSessionFields(values, now);
  return startAt === null ? { kind: "invalid", values, errors } : { kind: "ready", values, startAt, minutes };
}
