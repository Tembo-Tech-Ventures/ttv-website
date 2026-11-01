import type { Cursor, Id, Message, MessageList } from "../contracts";

/**
 * Pure, bounded paging state for one ordered list of messages (a channel's root
 * messages or one thread's replies). Messages themselves live in a normalised
 * entity map owned by the caller; a segment only records which ids are loaded,
 * in which server page they arrived and which cursors reach beyond its edges.
 */
export interface SegmentPage {
  ids: readonly Id[];
  /** Cursor for messages older than this page's first message; null when none exist. */
  before: Cursor | null;
}
export interface Segment {
  /** Oldest page first. Pages are never empty. */
  pages: readonly SegmentPage[];
  /** `before` cursor of the oldest retained page; null at the start of history or after a trim. */
  olderCursor: Cursor | null;
  /** Polling checkpoint after the newest retained message. */
  sinceCursor: Cursor;
  /** False once newer pages were evicted: polling stops until a fresh latest snapshot. */
  live: boolean;
  /** Older history exists but no cursor can reach it (the oldest page was trimmed). */
  olderTrimmed: boolean;
}
export type Entities = ReadonlyMap<Id, Message>;
export interface EvictOptions {
  maxMessages: number;
  /** Retained message the reader is looking at; null means the newest end. */
  anchorId: Id | null;
}

/** Display order: creation time, then id, so ties and reordered pages stay deterministic. */
export function compareMessages(a: Pick<Message, "createdAt" | "id">, b: Pick<Message, "createdAt" | "id">): number {
  return a.createdAt - b.createdAt || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
}

export function segmentIds(segment: Segment): Id[] {
  return segment.pages.flatMap(page => page.ids);
}

export function segmentSize(segment: Segment): number {
  return segment.pages.reduce((total, page) => total + page.ids.length, 0);
}

/** Ordered retained messages. Ids without an entity (never expected) are skipped. */
export function segmentMessages(segment: Segment, entities: Entities): Message[] {
  const result: Message[] = [];
  for (const id of segmentIds(segment)) {
    const message = entities.get(id);
    if (message) result.push(message);
  }
  return result.toSorted(compareMessages);
}

function uniqueIds(items: readonly Message[], exclude: ReadonlySet<Id>): Id[] {
  const seen = new Set<Id>();
  const ids: Id[] = [];
  for (const item of items.toSorted(compareMessages)) {
    if (exclude.has(item.id) || seen.has(item.id)) continue;
    seen.add(item.id);
    ids.push(item.id);
  }
  return ids;
}

/** A fresh latest snapshot. `items` must already be filtered to this segment's messages. */
export function segmentFromLatest(page: MessageList, items: readonly Message[]): Segment {
  const ids = uniqueIds(items, new Set());
  return {
    pages: ids.length > 0 ? [{ ids, before: page.beforeCursor }] : [],
    olderCursor: page.beforeCursor, sinceCursor: page.sinceCursor, live: true, olderTrimmed: false,
  };
}

/**
 * Prepend an older page fetched with `segment.olderCursor`. Messages already
 * retained keep their place (duplicates from shifted server pages are dropped).
 */
export function prependOlder(segment: Segment, page: MessageList, items: readonly Message[]): Segment {
  const ids = uniqueIds(items, new Set(segmentIds(segment)));
  return {
    ...segment,
    pages: ids.length > 0 ? [{ ids, before: page.beforeCursor }, ...segment.pages] : segment.pages,
    olderCursor: page.beforeCursor,
  };
}

/**
 * Decide whether a polled message that is not yet retained belongs in this
 * segment. Anything older than the oldest retained message, while older history
 * is still unloaded, would open a gap, so it is left for `loadOlder`.
 */
export function acceptsNew(segment: Segment, entities: Entities, message: Message): boolean {
  if (segment.olderCursor === null && !segment.olderTrimmed) return true;
  const ids = segmentIds(segment);
  if (ids.length === 0) return true;
  let oldest: Message | undefined;
  for (const id of ids) {
    const candidate = entities.get(id);
    if (candidate && (!oldest || compareMessages(candidate, oldest) < 0)) oldest = candidate;
  }
  return !oldest || compareMessages(message, oldest) > 0;
}

/**
 * Append a `since` delta. `items` must be new, accepted messages for this
 * segment. Small deltas join the newest page; a delta becomes its own page
 * (and so can be evicted separately) only when it carries its own `before`.
 */
export function appendNewer(segment: Segment, page: MessageList, items: readonly Message[], pageSize: number): Segment {
  const ids = uniqueIds(items, new Set(segmentIds(segment)));
  const pages = [...segment.pages];
  const newest = pages.at(-1);
  if (ids.length > 0) {
    if (!newest) pages.push({ ids, before: page.beforeCursor });
    else if (newest.ids.length + ids.length <= pageSize || page.beforeCursor === null) {
      pages[pages.length - 1] = { ...newest, ids: [...newest.ids, ...ids] };
    } else pages.push({ ids, before: page.beforeCursor });
  }
  return { ...segment, pages, sinceCursor: page.sinceCursor };
}

/** Remove tombstoned ids; empty pages disappear, keeping their neighbours' cursors. */
export function removeIds(segment: Segment, removed: ReadonlySet<Id>): Segment {
  if (removed.size === 0 || !segment.pages.some(page => page.ids.some(id => removed.has(id)))) return segment;
  const pages: SegmentPage[] = [];
  for (const page of segment.pages) {
    const ids = page.ids.filter(id => !removed.has(id));
    if (ids.length > 0) pages.push({ ...page, ids });
  }
  // An emptied oldest page's cursor stays valid: everything it held is gone.
  return { ...segment, pages };
}

function anchorPage(pages: readonly SegmentPage[], anchorId: Id | null): number {
  if (anchorId === null) return pages.length - 1;
  const index = pages.findIndex(page => page.ids.includes(anchorId));
  return index < 0 ? pages.length - 1 : index;
}

/**
 * Bound memory: drop whole pages from whichever end is farther from the anchor
 * page. Dropping older pages keeps the new oldest page's cursor, so they can be
 * loaded again. Dropping newer pages ends live polling until the reader jumps
 * back to the latest messages. As a last resort the anchor page itself is
 * trimmed at the end away from the anchor.
 */
export function evict(segment: Segment, { maxMessages, anchorId }: EvictOptions): Segment {
  const pages = [...segment.pages];
  let { olderCursor, live, olderTrimmed } = segment;
  let total = segmentSize(segment);
  while (total > maxMessages && pages.length > 1) {
    const anchor = anchorPage(pages, anchorId);
    const older = pages.slice(0, anchor).reduce((sum, page) => sum + page.ids.length, 0);
    const newer = total - older - pages[anchor].ids.length;
    const dropOldest = anchor > 0 && (older >= newer || anchor === pages.length - 1);
    const dropped = dropOldest ? pages.shift()! : pages.pop()!;
    total -= dropped.ids.length;
    if (dropOldest) { olderCursor = pages[0].before; olderTrimmed = false; }
    else live = false;
  }
  const next = { ...segment, pages, olderCursor, live, olderTrimmed };
  if (total > maxMessages) return trimOnlyPage(next, maxMessages, anchorId);
  return pages.length === segment.pages.length ? segment : next;
}

function trimOnlyPage(segment: Segment, maxMessages: number, anchorId: Id | null): Segment {
  const [page] = segment.pages;
  const index = anchorId === null ? -1 : page.ids.indexOf(anchorId);
  // Keep the anchor and the messages after it, where reading continues.
  const start = index < 0 ? page.ids.length - maxMessages : Math.min(index, page.ids.length - maxMessages);
  const trimmedOlder = start > 0;
  return {
    ...segment,
    pages: [{ ...page, ids: page.ids.slice(start, start + maxMessages) }],
    olderCursor: trimmedOlder ? null : segment.olderCursor,
    olderTrimmed: segment.olderTrimmed || trimmedOlder,
    live: segment.live && start + maxMessages >= page.ids.length,
  };
}
