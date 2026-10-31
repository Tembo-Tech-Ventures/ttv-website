import { useEffect, useState } from "react";
import type { AttentionList, MarkAttentionRead, Me } from "@/lib/platform/contracts";
import { createAttentionStore, type AttentionState, type AttentionStore } from "@/lib/platform/client/attention";
import type { ApiClient } from "@/lib/platform/client/apiClient";
import { createAnnouncer } from "@/lib/platform/client/announcer";
import { publishAttentionCounts } from "@/components/platform/shell/overlays";
import { unreadTotal } from "./attention-display";

export type Announcer = ReturnType<typeof createAnnouncer>;

export interface AttentionOwner {
  store: AttentionStore;
  announcer: Announcer;
}

/**
 * The page's one attention store, and the one voice that announces it. Exactly
 * one island owns it per page (the overlays on a space page, the inbox on the
 * attention page), so counts are polled once and nothing is announced twice.
 * It starts from the counts `Me` was rendered with, so the first poll waits 30s.
 */
export function useAttentionOwner(me: Me, options: { initialList?: AttentionList; api?: ApiClient } = {}): AttentionOwner {
  const [owner] = useState<AttentionOwner>(() => ({
    store: createAttentionStore({
      enabled: me.flags.spaces === true,
      api: options.api,
      initialList: options.initialList,
      initialCounts: { count: unreadTotal(me.unreadCounts, me.spaces), unreadCounts: me.unreadCounts },
    }),
    announcer: createAnnouncer({ throttleMs: 750, dedupeMs: 4_000 }),
  }));

  useEffect(() => () => owner.announcer.dispose(), [owner]);

  /* The bell and the tabs show what the store knows, as soon as it knows it. */
  useEffect(() => {
    const { store } = owner;
    const publish = () => publishAttentionCounts(store.getState().counts.unreadCounts);
    const stop = store.subscribe(publish);
    return () => stop();
  }, [owner]);

  useNewAttentionAnnouncements(owner);
  return owner;
}

/**
 * "2 new attention items", once per count poll that finds more. Read from the
 * count flights themselves rather than the store's announcement text, so the
 * same words are announced again when the same thing happens again, and a
 * rolled-back mark-read (the count going back up) is never called "new".
 */
function useNewAttentionAnnouncements({ store, announcer }: AttentionOwner) {
  useEffect(() => {
    let previous = store.getState();
    let before: number | null = null;
    let flight = 0;
    return store.subscribe(() => {
      const next = store.getState();
      if (!previous.counting && next.counting) before = next.counts.count;
      if (previous.counting && !next.counting && before !== null) {
        const increase = next.counts.count - before;
        if (!next.countError && next.pending.length === 0 && increase > 0) {
          announcer.announce(`${increase} new attention item${increase === 1 ? "" : "s"}`, "polite", `new:${++flight}`);
        }
        before = null;
      }
      previous = next;
    });
  }, [store, announcer]);
}

let actionSequence = 0;

/**
 * Marks read and says what happened. The store's promise is the truth: true
 * only once the server has counted it, false for a failure (which leaves a
 * retry entry), a full queue, or a store that stopped.
 */
export async function markReadAndAnnounce({ store, announcer }: AttentionOwner, body: MarkAttentionRead): Promise<boolean> {
  const failuresBefore = store.getState().failed.length;
  const ok = await store.markRead(body);
  const key = `read:${++actionSequence}`;
  if (ok) {
    announcer.announce("ids" in body ? "Marked read" : "All attention marked read", "polite", key);
  } else if (store.getState().failed.length > failuresBefore) {
    announcer.announce("Could not mark read. Try again is available.", "assertive", key);
  } else if (store.getState().pending.length >= 100) {
    announcer.announce("Too many changes are waiting. Try again in a moment.", "assertive", key);
  }
  return ok;
}

/** Loads (or reloads) the list and says so only when it failed. */
export async function loadAndAnnounce({ store, announcer }: AttentionOwner, load: () => Promise<void>): Promise<void> {
  await load();
  if (store.getState().listError) {
    announcer.announce("Could not load attention items", "assertive", `list:${++actionSequence}`);
  }
}

/**
 * Resolves once no mark-read is waiting. The store will not resume counts
 * while a write is pending (refreshCounts returns false without trying), so a
 * "Try again" after a paused count must wait for the writes to settle first.
 */
export function whenWritesSettle(store: AttentionStore): Promise<void> {
  if (store.getState().pending.length === 0) return Promise.resolve();
  return new Promise((resolve) => {
    const stop = store.subscribe(() => {
      if (store.getState().pending.length > 0) return;
      stop();
      resolve();
    });
  });
}

export type AttentionProblem = "signed-out" | "unavailable" | "failed";

/**
 * What a list or count error means to the person. A 404 is how the API says
 * "not for you right now": the spaces flag is off, or the session is gone (a
 * signed-out caller has no flags). 401/403 say the session or access changed.
 */
export function attentionProblem(error: AttentionState["listError"]): AttentionProblem | null {
  if (!error) return null;
  if (error.status === 401) return "signed-out";
  if (error.status === 403 || error.status === 404 || error.code === "flag_off") return "unavailable";
  return "failed";
}
