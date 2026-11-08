/**
 * Where each kind of unsent text waits in this tab's sessionStorage, and how sign-out forgets it.
 * Zod-free on purpose: the account menu is on every page, and clearing three key prefixes must not
 * load the forms, their schemas and the contract module that read and write those drafts (S6).
 */
export const ONBOARDING_DRAFT_PREFIX = "ttv-onboarding-drafts:";
export const CHANNEL_DRAFT_PREFIX = "ttv-channel-drafts:";
export const MENTOR_REQUEST_DRAFT_PREFIX = "ttv-mentor-request-draft:";

/** The parts of Web Storage drafts use. Inject one in tests; the default is `window.sessionStorage`. */
export type DraftStorage = Pick<Storage, "getItem" | "setItem" | "removeItem" | "key" | "length">;

/** SSR-safe and failure-tolerant: blocked storage (private modes, sandboxed frames) means no drafts. */
export function sessionDraftStorage(): DraftStorage | undefined {
  try { return typeof window === "undefined" ? undefined : window.sessionStorage; }
  catch { return undefined; }
}

/** Removes every key under these prefixes, every user's, from this tab. Storage is optional. */
export function clearDrafts(prefixes: readonly string[], storage: DraftStorage | undefined = sessionDraftStorage()): void {
  if (!storage) return;
  try {
    const keys: string[] = [];
    for (let i = 0; i < storage.length; i++) {
      const key = storage.key(i);
      if (key && prefixes.some((prefix) => key.startsWith(prefix))) keys.push(key);
    }
    for (const key of keys) storage.removeItem(key);
  } catch { /* Storage is optional. */ }
}

/** Call from sign-out: unsent onboarding requests, channel drafts and mentor requests, for whoever uses the tab next. */
export function clearAllDrafts(storage: DraftStorage | undefined = sessionDraftStorage()): void {
  clearDrafts([ONBOARDING_DRAFT_PREFIX, CHANNEL_DRAFT_PREFIX, MENTOR_REQUEST_DRAFT_PREFIX], storage);
}
