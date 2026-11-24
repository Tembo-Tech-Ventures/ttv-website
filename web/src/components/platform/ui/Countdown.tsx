import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { PiTimer, PiWarningCircle } from "react-icons/pi";
import {
  CALL_WARNINGS,
  CHECK_IN_WARNINGS,
  armWarnings,
  dueWarning,
  nextChange,
  timeLeft,
  urgency,
  warningMessage,
  type CountdownWarning,
  type Urgency,
} from "./countdown";
import { cx } from "./cx";
import { useAnnouncer } from "./LiveAnnouncer";

type CountdownProps = {
  /** When it ends, from the server's clock: an epoch in milliseconds, or a Date. */
  endsAt: number | Date;
  /**
   * What to say out loud, once each, through the nearest `LiveAnnouncer`:
   * `"call"` (15 and 5 minutes, then 1 minute and 10 seconds), `"check-in"`
   * (10 and 5 minutes, then the same), or a list of your own. Silent by default.
   */
  warnings?: "call" | "check-in" | readonly CountdownWarning[];
  /** What ends, as the warnings say it: "The session ends in 5 minutes." */
  subject?: string;
  /** Shows "Ends at 19:02" before the time left. */
  showEndTime?: boolean;
  /** The zone "Ends at" is written in. */
  timeZone?: string;
  /** Called once, when the time is up. The server ends the call; this only updates the screen. */
  onEnd?: () => void;
  /** The clock, for tests and for a caller that corrects for the server's. */
  now?: () => number;
  /**
   * When the server drew the page, in epoch milliseconds. With it, the server
   * draws the time left as it was then, and the browser's first render, which
   * must match, does the same before its clock takes over. Without it, the
   * time left is drawn only once the browser's clock runs, so a page that
   * hydrates a minute later never shows a stale state.
   */
  renderedAt?: number;
  className?: string;
};

const NO_WARNINGS: readonly CountdownWarning[] = [];

const INK: Record<Urgency, string> = {
  calm: "text-ink-secondary",
  soon: "text-warning-ink",
  now: "text-danger-ink",
  over: "text-danger-ink",
};

const REDUCED_MOTION = "(prefers-reduced-motion: reduce)";

function subscribeReducedMotion(change: () => void) {
  if (typeof window.matchMedia !== "function") return () => {};
  const query = window.matchMedia(REDUCED_MOTION);
  query.addEventListener("change", change);
  return () => query.removeEventListener("change", change);
}

/** Whether the person asked for less motion. False on the server and where the browser can't say. */
function usePrefersReducedMotion(): boolean {
  return useSyncExternalStore(
    subscribeReducedMotion,
    () => typeof window.matchMedia === "function" && window.matchMedia(REDUCED_MOTION).matches,
    () => false,
  );
}

/** The end, to the minute, rounded up as the minutes left are: 18:59:30 is "19:00", beside "13 min left" at 18:47. */
const endTime = (end: number, timeZone: string) =>
  new Intl.DateTimeFormat("en-GB", { hour: "2-digit", minute: "2-digit", hourCycle: "h23", timeZone }).format(Math.ceil(end / 60_000) * 60_000);

/**
 * The time left before something ends, such as a call: "Ends at 19:02 · 12
 * min left", in tabular numerals so the digits never jump. Whole minutes while
 * more than one is left, so it changes once a minute; then minutes and seconds,
 * in steps of ten seconds under reduced motion. Calm in the secondary ink, then
 * warning ink from 5 minutes and danger ink in the last minute, with an icon
 * that changes too; the words always say how long.
 *
 * It is a `timer`, which screen readers don't read as it changes. What they
 * hear are the `warnings`, each said once through the nearest `LiveAnnouncer`:
 * never every second, never one more than 2 seconds past when it started, and
 * still once when the server moves the end (`armWarnings`).
 */
export default function Countdown({
  endsAt,
  warnings,
  subject = "The call",
  showEndTime = true,
  timeZone = "Africa/Nairobi",
  onEnd,
  now,
  renderedAt,
  className,
}: CountdownProps) {
  const end = typeof endsAt === "number" ? endsAt : endsAt.getTime();
  const reduced = usePrefersReducedMotion();
  const voice = useAnnouncer();
  const list = warnings === "call" ? CALL_WARNINGS : warnings === "check-in" ? CHECK_IN_WARNINGS : (warnings ?? NO_WARNINGS);
  // Null until the browser's clock runs, unless the server said when it drew the page.
  const [seconds, setSeconds] = useState<number | null>(() => (renderedAt === undefined ? null : (end - renderedAt) / 1000));

  // The latest of everything the clock reads, so a new callback or list does not restart it.
  const latest = useRef({ voice, onEnd, subject, clock: now ?? Date.now, list });
  useEffect(() => {
    latest.current = { voice, onEnd, subject, clock: now ?? Date.now, list };
  });
  const warningKey = list.map((warning) => `${warning.at}:${warning.priority}`).join(",");
  /** The warnings said or no longer news, kept across a corrected end, so none is lost or said twice. */
  const spent = useRef<Set<number> | null>(null);

  useEffect(() => {
    const read = () => (end - latest.current.clock()) / 1000;
    let ended = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    spent.current = armWarnings(read(), latest.current.list, spent.current ?? new Set());

    function tick() {
      clearTimeout(timer);
      const left = read();
      setSeconds(left);
      const { voice: speaker, subject: what, list: due } = latest.current;
      const used = spent.current!;
      const { say, spend } = dueWarning(left, due, used);
      for (const at of spend) used.add(at);
      if (say) speaker?.say(warningMessage(say.at, what), { priority: say.priority, key: `countdown:${end}:${say.at}` });
      if (left <= 0) {
        if (!ended) latest.current.onEnd?.();
        ended = true;
        return;
      }
      timer = setTimeout(tick, nextChange(left, due, reduced));
    }

    tick();
    // A hidden tab's timers are slowed; look again as soon as it is back.
    const wake = () => {
      if (document.visibilityState === "visible") tick();
    };
    document.addEventListener("visibilitychange", wake);
    return () => {
      clearTimeout(timer);
      document.removeEventListener("visibilitychange", wake);
    };
  }, [end, reduced, warningKey]);

  const level = seconds === null ? "calm" : urgency(seconds);
  const told = seconds === null ? null : timeLeft(seconds, reduced);
  const Icon = level === "calm" ? PiTimer : PiWarningCircle;

  return (
    <p
      data-countdown
      data-urgency={level}
      className={cx(
        "m-0 inline-flex min-w-0 flex-wrap items-center gap-x-1.5 gap-y-0.5 text-sm font-semibold tabular-nums transition-colors duration-150 motion-reduce:transition-none",
        INK[level],
        className,
      )}
    >
      <Icon aria-hidden="true" className="size-4 shrink-0" />
      {showEndTime && (
        <>
          <span>Ends at {endTime(end, timeZone)}</span>
          <span aria-hidden="true">·</span>
        </>
      )}
      <span role="timer">
        {told && (
          <>
            <span aria-hidden="true">{told.shown}</span>
            <span className="sr-only">{told.spoken}</span>
          </>
        )}
      </span>
    </p>
  );
}
