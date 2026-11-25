import { CALL_BOOK_AHEAD_DAYS, CALL_LIMIT_MINUTES, MAX_PROPOSED_TIMES, type CallProposalPurpose } from "@/lib/meetings/rules";
import { CALL_LENGTHS } from "@/lib/meetings/proposals";
import { isTimeZone, SESSION_TIME_ZONE, zonedFields, zonedMoment } from "@/lib/meetings/session-times";

/**
 * The suggest form's fields, read and checked on the server (it posts without JavaScript): a call or a
 * check-in on one piece of work, its length, up to MAX_PROPOSED_TIMES dates and times, and "Ask to
 * record". Times are entered in the suggester's own time zone: Nairobi's unless their browser says
 * otherwise (the page's script sets `zone` from the device), and stored as the moments they name.
 * The form carries its own `token`, made when it was first shown, so sending it twice suggests once.
 * A round of new times for a booked call is checked first ("Review"), then sent. suggestCall checks
 * everything again.
 */

export const CALL_KINDS = ["CALL", "CHECKIN"] as const satisfies readonly CallProposalPurpose[];
export const DEFAULT_CALL_LENGTH = 30;
const DAY_MS = 24 * 60 * 60_000;
/** The slots on the form, one per time that can be suggested. */
export const TIME_SLOTS = Array.from({ length: MAX_PROPOSED_TIMES }, (_, index) => index + 1);

export interface SuggestValues {
  token: string;
  conversation: string;
  /** The other person's suggestion this answers with other times. */
  instead: string;
  /** The booked call these times would move. */
  change: string;
  purpose: CallProposalPurpose;
  work: string;
  length: string;
  zone: string;
  /** One date and time per slot, as typed. */
  dates: string[];
  clocks: string[];
  record: boolean;
}

export type SuggestField = "purpose" | "work" | "length" | "zone" | "times" | `date${number}` | `time${number}`;
export type FieldErrors = Partial<Record<SuggestField, string>>;

export type SuggestReading =
  | { kind: "invalid"; values: SuggestValues; errors: FieldErrors }
  | { kind: "ready"; values: SuggestValues; times: number[]; minutes: number; review: boolean };

const text = (form: FormData, name: string) => {
  const value = form.get(name);
  return typeof value === "string" ? value.trim() : "";
};

/** A blank form for a conversation, its new times answering `instead` or moving `change`. */
export function blankSuggestion(token: string, conversation: string, { instead = "", change = "", purpose = "CALL" as CallProposalPurpose, work = "", length = String(DEFAULT_CALL_LENGTH), record = false } = {}): SuggestValues {
  return {
    token, conversation, instead, change, purpose, work, length, zone: SESSION_TIME_ZONE,
    dates: TIME_SLOTS.map(() => ""), clocks: TIME_SLOTS.map(() => ""), record,
  };
}

/** A moment's date and time fields in `zone`, to show a time again on the form. */
export const fieldsIn = (ms: number, zone: string) => zonedFields(ms, isTimeZone(zone) ? zone : SESSION_TIME_ZONE);

/** Reads the posted form. An empty slot is skipped; a slot with only a date or only a time is an error. */
export function readSuggestion(form: FormData, now: number): SuggestReading {
  const purpose = text(form, "purpose");
  const zone = text(form, "zone") || SESSION_TIME_ZONE;
  const values: SuggestValues = {
    token: text(form, "token"), conversation: text(form, "conversation"), instead: text(form, "instead"), change: text(form, "change"),
    purpose: (CALL_KINDS as readonly string[]).includes(purpose) ? purpose as CallProposalPurpose : "CALL",
    work: text(form, "work"), length: text(form, "length") || String(DEFAULT_CALL_LENGTH), zone,
    dates: TIME_SLOTS.map((slot) => text(form, `date${slot}`)), clocks: TIME_SLOTS.map((slot) => text(form, `time${slot}`)),
    record: form.get("record") === "on",
  };
  const errors: FieldErrors = {};
  if (!(CALL_KINDS as readonly string[]).includes(purpose) && !values.change) errors.purpose = "Choose a call or a project check-in.";
  if (values.purpose === "CHECKIN" && !values.change && !values.work) errors.work = "Choose the work this check-in is about.";
  const minutes = Number(values.length);
  if (values.purpose === "CALL" && !CALL_LENGTHS.includes(minutes)) errors.length = `Choose a length of up to ${CALL_LIMIT_MINUTES} minutes.`;
  if (!isTimeZone(zone)) errors.zone = "Choose the time zone the times are in.";

  const times = errors.zone ? [] : readTimes(values, now, errors);
  if (times.length === 0 && !TIME_SLOTS.some((slot) => errors[`date${slot}`] || errors[`time${slot}`])) {
    errors.date1 = "Suggest at least one time.";
  }
  if (Object.keys(errors).length > 0) return { kind: "invalid", values, errors };
  return { kind: "ready", values, times: times.toSorted((a, b) => a - b), minutes, review: text(form, "intent") === "review" };
}

/** The moments the slots name, in the form's zone; each slot's problem goes in `errors` beside it. */
function readTimes(values: SuggestValues, now: number, errors: FieldErrors): number[] {
  const times: number[] = [];
  for (const [index, slot] of TIME_SLOTS.entries()) {
    const problem = slotProblem(values.dates[index]!, values.clocks[index]!, values.zone, now, times);
    if (problem === null) continue;
    if (typeof problem === "number") times.push(problem);
    else errors[`${problem.field}${slot}`] = problem.message;
  }
  return times;
}

/** One slot: nothing (empty), its moment, or what to change and in which of its two fields. */
function slotProblem(date: string, clock: string, zone: string, now: number, earlier: readonly number[]): number | null | { field: "date" | "time"; message: string } {
  if (!date && !clock) return null;
  if (!date) return { field: "date", message: "Choose a date for this time." };
  if (!clock) return { field: "time", message: "Enter a start time, like 17:00." };
  const at = zonedMoment(date, clock, zone);
  if (at === null) return { field: "date", message: "Enter a real date and time, like 2026-11-27 and 17:00." };
  if (at <= now) return { field: "date", message: "Choose a time that hasn't passed yet." };
  if (at > now + CALL_BOOK_AHEAD_DAYS * DAY_MS) return { field: "date", message: `Calls can be suggested up to ${CALL_BOOK_AHEAD_DAYS} days ahead.` };
  if (earlier.includes(at)) return { field: "date", message: "This is the same time as one above. Choose another, or leave it empty." };
  return at;
}
