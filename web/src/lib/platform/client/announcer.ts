import { createStore } from "./store";

export interface Announcement {
  id: number;
  message: string;
  priority: "polite" | "assertive";
}

export interface AnnouncerOptions {
  throttleMs?: number;
  dedupeMs?: number;
  /** Bounds both pending announcements and remembered deduplication keys. */
  maxQueue?: number;
}

export function createAnnouncer({ throttleMs = 1_000, dedupeMs = 5_000, maxQueue = 50 }: AnnouncerOptions = {}) {
  if (!Number.isFinite(throttleMs) || throttleMs < 0 || !Number.isFinite(dedupeMs) || dedupeMs < 0
    || !Number.isInteger(maxQueue) || maxQueue < 1) throw new RangeError("Invalid announcer options");
  const store = createStore<Announcement | null>(null);
  const queue: { entry: Announcement; key: string }[] = [];
  const seen = new Map<string, { at: number; id: number }>();
  let timer: ReturnType<typeof setTimeout> | undefined;
  let disposed = false;
  let id = 0;

  function flush() {
    const next = queue.shift();
    if (!next) { timer = undefined; return; }
    // Set the guard before notifying subscribers, which may enqueue more work.
    timer = setTimeout(flush, throttleMs);
    store.setState(next.entry);
  }

  return {
    store,
    /** Returns false for empty, duplicate, disposed or immediately dropped entries. */
    announce(message: string, priority: Announcement["priority"] = "polite", key = `${priority}:${message}`): boolean {
      if (disposed || !message.trim()) return false;
      const now = Date.now();
      for (const [oldKey, value] of seen) if (now - value.at >= dedupeMs) seen.delete(oldKey);
      if (seen.has(key)) return false;
      const entry = { id: ++id, message, priority };
      seen.set(key, { at: now, id: entry.id });
      if (seen.size > maxQueue) seen.delete(seen.keys().next().value!);
      const pending = { entry, key };
      // Urgent announcements precede pending polite ones, still respecting the throttle.
      if (priority === "assertive") {
        const firstPolite = queue.findIndex(item => item.entry.priority === "polite");
        if (firstPolite < 0) queue.push(pending);
        else queue.splice(firstPolite, 0, pending);
      } else queue.push(pending);
      const dropped = queue.length > maxQueue ? queue.pop() : undefined;
      if (dropped && seen.get(dropped.key)?.id === dropped.entry.id) seen.delete(dropped.key);
      if (timer === undefined) flush();
      return dropped !== pending;
    },
    /** Remove text after the UI has consumed it; does not reset the throttle. */
    clear() { store.setState(null); },
    dispose() {
      disposed = true;
      clearTimeout(timer);
      timer = undefined;
      queue.length = 0;
      seen.clear();
      store.setState(null);
    },
  };
}
