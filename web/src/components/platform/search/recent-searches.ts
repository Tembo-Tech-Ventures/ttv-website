/**
 * Recent searches belong to one person on one browser. They are stored under
 * a key that names the person, other people's lists are removed when someone
 * else's search opens on this browser, and every list is removed when the
 * person signs out from the shell. Search text typed but never chosen is never
 * stored: the store remembers a query only when a result is opened.
 */
export const RECENT_PREFIX = "ttv:search-recent:v1:";

export function recentSearchKey(userId: string): string {
  return `${RECENT_PREFIX}${userId}`;
}

type KeyedStorage = Pick<Storage, "length" | "key" | "removeItem">;

function browserStorage(): KeyedStorage | undefined {
  try {
    return typeof window === "undefined" ? undefined : window.localStorage;
  } catch {
    return undefined;
  }
}

/** Removes stored recent searches, all of them or all but `keepKey`'s. Storage is optional; failures are ignored. */
export function clearRecentSearches(keepKey?: string, storage: KeyedStorage | undefined = browserStorage()): void {
  if (!storage) return;
  try {
    const keys: string[] = [];
    for (let index = 0; index < storage.length; index++) {
      const key = storage.key(index);
      if (key?.startsWith(RECENT_PREFIX) && key !== keepKey) keys.push(key);
    }
    for (const key of keys) storage.removeItem(key);
  } catch {
    /* Storage may be blocked; there is then nothing stored to clear. */
  }
}

/**
 * Calls `onSignOut` when the shell's sign-out control is used: its link is
 * followed or its form submitted. Capture phase, so it runs before the page
 * starts to leave. Returns the unsubscribe function.
 */
export function onShellSignOut(onSignOut: () => void, root: Document = document): () => void {
  const click = (event: Event) => {
    if ((event.target as Element | null)?.closest?.("a[data-shell-sign-out]")) onSignOut();
  };
  const submit = (event: Event) => {
    if ((event.target as Element | null)?.matches?.("form[data-shell-sign-out]")) onSignOut();
  };
  root.addEventListener("click", click, true);
  root.addEventListener("submit", submit, true);
  return () => {
    root.removeEventListener("click", click, true);
    root.removeEventListener("submit", submit, true);
  };
}
