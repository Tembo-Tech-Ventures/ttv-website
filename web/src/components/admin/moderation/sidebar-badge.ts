import { MODERATION_HREF } from "@/components/admin/admin-nav";
import { MODERATION_PENDING_EVENT } from "./case-model";

/*
 * The Moderation count in the Admin space's sidebar (the spaces shell's, or PlainFrame's). The sidebar
 * is server-rendered, so after a decision swaps the queue in place (enhance.ts reports the queue's new
 * waiting count), this rewrites the badge's number and its spoken label. The open request-note checks are part of the badge too (QA4-04), so the page hands them in.
 * A badge the server did not draw (nothing was waiting) stays absent until the next load: a decision
 * needs something waiting, so the count can only have gone down.
 */

const MAX = 99;

/** Rewrites the sidebar's Moderation badge to `total`, hiding it at zero. Returns whether a badge was there. */
export function setModerationBadge(doc: Document, total: number): boolean {
  const badge = doc.querySelector<HTMLElement>(`#space-sidebar a[href="${MODERATION_HREF}"] [data-count-badge="count"]`);
  if (!badge) return false;
  const shown = badge.querySelector<HTMLElement>("[aria-hidden='true']");
  const spoken = badge.querySelector<HTMLElement>(".sr-only");
  badge.hidden = total < 1;
  if (shown) shown.textContent = total > MAX ? `${MAX}+` : String(total);
  if (spoken) spoken.textContent = `${total} waiting`;
  return true;
}

/** Follows the queue's reported count for as long as the page lives. Returns the way to stop. */
export function followModerationBadge(doc: Document, requestNotes: number): () => void {
  const onPending = (event: Event) => {
    const waiting = (event as CustomEvent<unknown>).detail;
    if (typeof waiting === "number" && Number.isInteger(waiting) && waiting >= 0) setModerationBadge(doc, waiting + requestNotes);
  };
  doc.addEventListener(MODERATION_PENDING_EVENT, onPending);
  return () => doc.removeEventListener(MODERATION_PENDING_EVENT, onPending);
}
