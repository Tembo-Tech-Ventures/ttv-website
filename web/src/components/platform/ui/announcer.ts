import { createAnnouncer, type Announcement, type AnnouncerOptions } from "@/lib/platform/client/announcer";

/** How a screen reader hears it: `polite` waits until it has finished speaking, `assertive` interrupts. */
export type Politeness = Announcement["priority"];

export type LiveAnnouncerOptions = AnnouncerOptions & {
  /** How long `gather` waits for more of the same kind before speaking once for all of them. */
  gatherMs?: number;
};

export type GatherOptions = {
  /** The one sentence for everything gathered: `(names) => groupSentence(names, "joined")`. */
  sentence: (items: readonly string[]) => string;
  priority?: Politeness;
  /** Who or what the item is, when its words may not be unique: two people can share a name. The item itself by default. */
  id?: string;
};

/**
 * "Kevin Omondi joined", "Kevin Omondi and Faith Wanjiru joined", "Kevin
 * Omondi and 2 others joined": a burst of the same event, said once. Names
 * keep the order they arrived in, and the first one is always said in full.
 */
export function groupSentence(names: readonly string[], verb: string): string {
  const [first, second] = names;
  if (first === undefined) return "";
  if (second === undefined) return `${first} ${verb}`;
  if (names.length === 2) return `${first} and ${second} ${verb}`;
  return `${first} and ${names.length - 1} others ${verb}`;
}

/**
 * The kit's announcer: one voice for a page or an island, spoken through the
 * polite and assertive live regions `LiveAnnouncer` draws.
 *
 * - `say` speaks once. The same words with the same priority are dropped for
 *   `dedupeMs` (5 s), so a burst never repeats itself, and messages are spaced
 *   at least `throttleMs` (1 s) apart, assertive ones first.
 * - `gather` collects events of one kind (people joining) for `gatherMs` (2 s)
 *   and then says one sentence for all of them.
 *
 * Nothing here runs on a clock of its own: it speaks only when asked, so a
 * caller that never asks every second is never heard every second.
 */
export function createLiveAnnouncer({ gatherMs = 2_000, ...options }: LiveAnnouncerOptions = {}) {
  if (!Number.isFinite(gatherMs) || gatherMs < 0) throw new RangeError("Invalid gatherMs");
  const voice = createAnnouncer(options);
  const groups = new Map<string, { items: Map<string, string>; options: GatherOptions; timer: ReturnType<typeof setTimeout> }>();
  let disposed = false;

  function speakGroup(key: string) {
    const group = groups.get(key);
    groups.delete(key);
    if (!group || disposed) return;
    voice.announce(group.options.sentence([...group.items.values()]), group.options.priority ?? "polite");
  }

  return {
    /** The latest message, for the live regions. */
    store: voice.store,
    /** Whether `dispose` has run: `LiveAnnouncer` makes a new one when React remounts it (StrictMode). */
    get disposed() {
      return disposed;
    },
    /** Says `message` once. Returns false when it was empty or a repeat, and so not said. */
    say(message: string, { priority = "polite", key }: { priority?: Politeness; key?: string } = {}): boolean {
      return voice.announce(message, priority, key);
    },
    /**
     * Adds `item` to the burst named `key`; the burst is said as one sentence
     * when `gatherMs` has passed since its first item. The same item (by
     * `how.id`, else its words) twice in one burst counts once. The latest
     * `how` wins.
     */
    gather(key: string, item: string, how: GatherOptions): void {
      if (disposed || !item.trim()) return;
      const id = how.id ?? item;
      const group = groups.get(key);
      if (group) {
        if (!group.items.has(id)) group.items.set(id, item);
        group.options = how;
        return;
      }
      groups.set(key, { items: new Map([[id, item]]), options: how, timer: setTimeout(() => speakGroup(key), gatherMs) });
    },
    /** Stops for good: nothing pending is said, and nothing new is taken. */
    dispose(): void {
      disposed = true;
      for (const group of groups.values()) clearTimeout(group.timer);
      groups.clear();
      voice.dispose();
    },
  };
}

export type LiveAnnouncerVoice = ReturnType<typeof createLiveAnnouncer>;
