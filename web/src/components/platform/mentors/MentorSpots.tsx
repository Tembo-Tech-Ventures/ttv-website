import type { MentorAvailability } from "@/lib/platform/contracts";
import { openingDate, usedShare } from "./mentor-display";

/**
 * Spots used this month, as members count them: each request waiting for an answer holds one, and so
 * does each one accepted this month (QA4-13). `used` is the server's count, or the island's once
 * answers on the page have freed some.
 */
export default function MentorSpots({ availability, used }: { availability: MentorAvailability; used: number }) {
  const { limit } = availability.capacity;
  const full = used >= limit && limit > 0;
  const opening = availability.capacity.nextOpeningAt;
  return (
    <>
      <p className="text-sm text-ink-secondary">Spots used</p>
      <p className="mt-1 text-3xl font-bold text-ink-primary" data-spots-used>{used} of {limit}</p>
      <meter className="sr-only" min={0} max={Math.max(limit, 1)} value={used} aria-label="Spots used this month">{used} of {limit}</meter>
      <div className="mentor-meter mt-3" aria-hidden="true">
        <div className="mentor-meter__fill" style={{ width: `${Math.round(usedShare({ ...availability.capacity, used }) * 100)}%` }} />
      </div>
      <p className="mt-3 text-sm leading-relaxed text-ink-secondary" data-spots-note>
        {availability.paused
          // Paused, the mentor isn't in the directory at all, so nobody sees an opening date (QA4-15).
          ? "You've paused new requests, so you're not in the mentor directory. Requests already waiting stay with you."
          : full
            ? opening !== null
              ? `You're full. Members see "Next opening ${openingDate(opening)}" instead of a request button.`
              : "You're full while these requests wait for your answer."
            : `When you're full, members see when your next opening is instead of a request button.`}
      </p>
      <p className="mt-2 text-sm leading-relaxed text-ink-secondary">
        Each request waiting for your answer holds a spot, and so does each one you accept this month.
      </p>
    </>
  );
}
