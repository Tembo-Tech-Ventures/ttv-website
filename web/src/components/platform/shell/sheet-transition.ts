/**
 * When the card-file transition plays (SheetTransition.astro).
 *
 * The sheet rises only when a different sheet comes to the front: another
 * space, or the next onboarding step. A form that posts back, or a link to
 * another page of the same space, keeps the sheet where it is, so the page
 * changes under the reader without a 250ms animation swallowing their clicks.
 *
 * The new page knows its own sheet. It learns the one it came from because
 * every sheet page records `{ url, sheet }` in sessionStorage as it is left
 * (`pageswap`); the record counts only if its URL is the page the browser says
 * it came from. Without one, a navigation that stays on the same path (a
 * post-back) counts as the same sheet.
 */

/** Which sheet a page shows: `space:<id>` in the spaces shell, `onboarding:<step>` in onboarding. */
export type SheetKey = `space:${string}` | `onboarding:${string}`;

export const SHEET_STORAGE_KEY = "ttv-sheet";

export interface SheetSide {
  url: string;
  /** Null when the page it came from left no record (or a record for another page). */
  sheet: string | null;
}

/** Whether the arriving page shows the same sheet as the one it replaced, so nothing should move. */
export function keepsSheet(from: SheetSide, to: SheetSide): boolean {
  if (from.sheet !== null && to.sheet !== null) return from.sheet === to.sheet;
  return new URL(from.url).pathname === new URL(to.url).pathname;
}

/**
 * Runs in the page, before its first render. It is serialised with
 * `Function.prototype.toString` (see `sheetTransitionScript`), so it must
 * not refer to anything outside its parameters and the browser's globals.
 */
function installSheetTransition(sheet: string, storageKey: string, keeps: typeof keepsSheet): void {
  const readFrom = (fromUrl: string): string | null => {
    try {
      const record: unknown = JSON.parse(sessionStorage.getItem(storageKey) ?? "null");
      if (typeof record !== "object" || record === null) return null;
      const { url, sheet: recorded } = record as { url?: unknown; sheet?: unknown };
      return url === fromUrl && typeof recorded === "string" ? recorded : null;
    } catch {
      return null;
    }
  };
  addEventListener("pagereveal", (event) => {
    const { viewTransition } = event as Event & { viewTransition: { skipTransition(): void } | null };
    const from = (globalThis as { navigation?: { activation?: { from?: { url: string | null } | null } | null } })
      .navigation?.activation?.from?.url;
    if (viewTransition && from && keeps({ url: from, sheet: readFrom(from) }, { url: location.href, sheet })) {
      viewTransition.skipTransition();
    }
  });
  addEventListener("pageswap", () => {
    try {
      sessionStorage.setItem(storageKey, JSON.stringify({ url: location.href, sheet }));
    } catch {
      // Storage refused (a private window's quota, say): the next page falls back to comparing paths.
    }
  });
}

/** The inline, render-blocking script that SheetTransition puts in the head. */
export function sheetTransitionScript(sheet: SheetKey): string {
  // A `<` in a string could close the script early: the key is ours, but escape it anyway.
  const literal = (value: string) => JSON.stringify(value).replaceAll("<", "\\u003c");
  return `(${installSheetTransition.toString()})(${literal(sheet)}, ${literal(SHEET_STORAGE_KEY)}, ${keepsSheet.toString()});`;
}
