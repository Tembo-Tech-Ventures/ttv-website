/**
 * The calendar file for one call (RFC 5545), for "Add to calendar". There are no email reminders, so
 * this is how a session reaches a person's own calendar. Every time is UTC ("Z"), so no VTIMEZONE is
 * needed and every calendar shows the moment in its own zone. The UID is the call's own, so adding a
 * moved session again replaces the old entry (with a higher SEQUENCE) instead of adding a second one.
 * Google Calendar and Apple Calendar both require UID and DTSTAMP, read only CRLF-folded lines, and
 * drop a file whose text values carry unescaped commas, semicolons or newlines.
 */

export interface CalendarEvent {
  /** The call's id: the UID, stable for the call's life. */
  id: string;
  title: string;
  description: string;
  /** Where to go: the page the call is joined from. */
  url: string;
  startAt: number;
  minutes: number;
  /** When the file is made (DTSTAMP). */
  now: number;
  /** Rises each time the call changes, so a calendar replaces the copy it has. */
  sequence: number;
  cancelled?: boolean;
}

export const CALENDAR_DOMAIN = "tembotechventures.com";
const CRLF = "\r\n";
const LINE_OCTETS = 75;

/** A moment as an iCalendar UTC date-time: 20261127T150000Z. */
export function icsTime(ms: number): string {
  return new Date(Math.floor(ms / 1000) * 1000).toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
}

/** A TEXT value: backslash, semicolon, comma and newlines escaped (RFC 5545 §3.3.11). */
export function icsText(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/;/g, "\\;").replace(/,/g, "\\,").replace(/\r\n|\r|\n/g, "\\n");
}

/** One content line, folded so no line is longer than 75 octets, never inside a UTF-8 character (§3.1). */
export function foldLine(line: string): string {
  const encoder = new TextEncoder();
  const lines: string[] = [];
  let current = "";
  let octets = 0;
  for (const char of line) {
    const size = encoder.encode(char).length;
    // Continuation lines start with a space, which counts toward their 75.
    if (octets + size > LINE_OCTETS) {
      lines.push(current);
      current = " ";
      octets = 1;
    }
    current += char;
    octets += size;
  }
  lines.push(current);
  return lines.join(CRLF);
}

/** The whole file: one VCALENDAR with one VEVENT, CRLF line ends, folded. */
export function calendarFile(event: CalendarEvent): string {
  const lines = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//Tembo Tech Ventures//TTV sessions//EN",
    "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH",
    "BEGIN:VEVENT",
    `UID:${event.id}@${CALENDAR_DOMAIN}`,
    `DTSTAMP:${icsTime(event.now)}`,
    `DTSTART:${icsTime(event.startAt)}`,
    `DTEND:${icsTime(event.startAt + event.minutes * 60_000)}`,
    `SEQUENCE:${Math.max(0, Math.floor(event.sequence))}`,
    `STATUS:${event.cancelled ? "CANCELLED" : "CONFIRMED"}`,
    `SUMMARY:${icsText(event.title)}`,
    `DESCRIPTION:${icsText(event.description)}`,
    `URL:${event.url}`,
    "TRANSP:OPAQUE",
    "END:VEVENT",
    "END:VCALENDAR",
  ];
  return lines.map(foldLine).join(CRLF) + CRLF;
}
