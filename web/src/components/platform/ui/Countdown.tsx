import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { PiTimer, PiWarningCircle } from "react-icons/pi";
import {
  CALL_WARNINGS,
  CHECK_IN_WARNINGS,
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

const endTime = (end: number, timeZone: string) =>
  new Intl.DateTimeFormat("en-GB", { hour: "2-digit", minute: "2-digit", hourCycle: "h23", timeZone }).format(end);

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
 * never every second, and never one already past when it started.
 */
export default function Countdown({
  endsAt,
  warnings,
  subject = "The call",
  showEndTime = true,
  timeZone = "Africa/Nairobi",
  onEnd,
  now,
  className,
}: CountdownProps) {
  const end = typeof endsAt === "number" ? endsAt : endsAt.getTime();
  const clock = now ?? Date.now;
  const reduced = usePrefersReducedMotion();
  const voice = useAnnouncer();
  const list = warnings === "call" ? CALL_WARNINGS : warnings === "check-in" ? CHECK_IN_WARNINGS : (warnings ?? NO_WARNINGS);
  const [seconds, setSeconds] = useState(() => (end - clock()) / 1000);

  // The latest of everything the clock reads, so a new callback or list does not restart it.
  const latest = useRef({ voice, onEnd, subject, clock, list });
  useEffect(() => {
    latest.current = { voice, onEnd, subject, clock, list };
  });
  const warningKey = list.map((warning) => `${warning.at}:${warning.priority}`).join(",");

  useEffect(() => {
    const read = () => (end - latest.current.clock()) / 1000;
    const spent = new Set<number>();
    let ended = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    // Warnings already past when it starts are not news: they are spent without a word.
    const start = read();
    for (const warning of latest.current.list) if (start <= warning.at) spent.add(warning.at);

    function tick() {
      clearTimeout(timer);
      const left = read();
      setSeconds(left);
      const { voice: speaker, subject: what, list: due } = latest.current;
      const { say, spend } = dueWarning(left, due, spent);
      for (const at of spend) spent.add(at);
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

  const level = urgency(seconds);
  const { shown, spoken } = timeLeft(seconds, reduced);
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
        <span aria-hidden="true" suppressHydrationWarning>
          {shown}
        </span>
        <span className="sr-only" suppressHydrationWarning>
          {spoken}
        </span>
      </span>
    </p>
  );
}
