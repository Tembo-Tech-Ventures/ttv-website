import type { Me } from "@/lib/platform/contracts";

/**
 * Shared work waiting for this person's confirmation, as far as the page
 * knows: zero without the Mentoring space, the server's derived count with
 * it, and null when the server could not say. Null is never read as zero, so
 * no surface claims nothing is waiting when that is unknown.
 */
export function awaitingConfirmation(me: Me): number | null {
  if (!me.spaces.includes("mentoring")) return 0;
  return me.mentoring?.awaitingConfirmation ?? null;
}

export function awaitingConfirmationText(count: number): string {
  return count === 1
    ? "1 shared contribution is waiting for your confirmation."
    : `${count} shared contributions are waiting for your confirmation.`;
}
