import { SESSION_TIME_ZONE } from "@/lib/meetings/session-times";

/**
 * Times are written in Nairobi time with "EAT" beside them (sessions are entered in Nairobi time).
 * Where the reader's device keeps another time, this adds theirs after it: "18:00–18:45 EAT · 16:00–
 * 16:45 your time". Without script, or in Nairobi's time already, the page reads the same without it.
 * Each `[data-local-time]` element carries the start (`datetime`) and `data-minutes`; the words go in
 * its `[data-local-time-out]` child.
 */

const clock = (timeZone?: string) => new Intl.DateTimeFormat("en-GB", { hour: "2-digit", minute: "2-digit", hourCycle: "h23", timeZone });
const day = (timeZone?: string) => new Intl.DateTimeFormat("en-GB", { weekday: "short", day: "numeric", month: "short", timeZone });

/** The reader's own time for a session, or null when it reads the same as Nairobi's. */
export function localTimeText(startAt: number, minutes: number, timeZone?: string): string | null {
  const end = startAt + minutes * 60_000;
  const here = { clock: clock(timeZone), day: day(timeZone) };
  const nairobi = { clock: clock(SESSION_TIME_ZONE), day: day(SESSION_TIME_ZONE) };
  const same = here.clock.format(startAt) === nairobi.clock.format(startAt) && here.day.format(startAt) === nairobi.day.format(startAt);
  if (same) return null;
  const otherDay = here.day.format(startAt) !== nairobi.day.format(startAt) ? `${here.day.format(startAt).replace(",", "")}, ` : "";
  return `${otherDay}${here.clock.format(startAt)}–${here.clock.format(end)} your time`;
}

export function showLocalTimes(root: ParentNode = document): void {
  for (const element of root.querySelectorAll<HTMLElement>("[data-local-time]")) {
    const startAt = Date.parse(element.getAttribute("datetime") ?? "");
    const minutes = Number(element.dataset.minutes);
    const out = element.querySelector<HTMLElement>("[data-local-time-out]");
    if (!out || Number.isNaN(startAt) || !Number.isFinite(minutes)) continue;
    const text = localTimeText(startAt, minutes);
    out.textContent = text ? ` · ${text}` : "";
  }
}
