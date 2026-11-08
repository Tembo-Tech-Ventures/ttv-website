/*
 * The confirm step's address. A destructive action starts as a link to the
 * same page with `?confirm=<action>`; the page then draws a `ConfirmStep` in
 * place of (or above) the thing it acts on. No script, no `confirm()`.
 */

/** The query parameter that holds the action waiting to be confirmed. */
export const CONFIRM_PARAM = "confirm";

/** The link that asks to confirm `action` on this page, keeping its other parameters. */
export function confirmHref(url: URL, action: string): string {
  const next = new URL(url);
  next.searchParams.set(CONFIRM_PARAM, action);
  next.hash = "";
  return `${next.pathname}${next.search}`;
}

/** The action this request asks to confirm, if it is one the page offers. */
export function confirmingAction<A extends string>(url: URL, offered: readonly A[]): A | null {
  const asked = url.searchParams.get(CONFIRM_PARAM);
  return offered.find((action) => action === asked) ?? null;
}

/** The same page without the confirm step: where Cancel goes. */
export function withoutConfirm(url: URL): string {
  const next = new URL(url);
  next.searchParams.delete(CONFIRM_PARAM);
  return `${next.pathname}${next.search}`;
}
