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
  const queue: Announcement[] = [];
  const seen = new Map<string, number>();
  let timer: ReturnType<typeof setTimeout> | undefined;
  let disposed = false;
  let id = 0;

  function flush() {
    const next = queue.shift();
    if (!next) { timer = undefined; return; }
    // Set the guard before notifying subscribers, which may enqueue more work.
    timer = setTimeout(flush, throttleMs);
    store.setState(next);
  }

  return {
    store,
    /** Returns false for empty, duplicate or disposed announcements. */
    announce(message: string, priority: Announcement["priority"] = "polite", key = `${priority}:${message}`): boolean {
      if (disposed || !message.trim()) return false;
      const now = Date.now();
      for (const [oldKey, at] of seen) if (now - at >= dedupeMs) seen.delete(oldKey);
      if (seen.has(key)) return false;
      seen.set(key, now);
      if (seen.size > maxQueue) seen.delete(seen.keys().next().value!);
      const entry = { id: ++id, message, priority };
      // Urgent announcements precede pending polite ones, still respecting the throttle.
      if (priority === "assertive") {
        const firstPolite = queue.findIndex(item => item.priority === "polite");
        if (firstPolite < 0) queue.push(entry);
        else queue.splice(firstPolite, 0, entry);
      } else queue.push(entry);
      if (queue.length > maxQueue) queue.pop();
      if (timer === undefined) flush();
      return true;
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
