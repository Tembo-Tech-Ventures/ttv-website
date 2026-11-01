import { z } from "zod";
import { ClientNonce, EmbedRef, Id, MarkdownBody, Timestamp, type Id as IdType } from "../contracts";
import { sessionDraftStorage, type DraftStorage } from "./onboarding-drafts";

export type { DraftStorage };

/**
 * Unsent channel text, per signed-in user and channel, in sessionStorage only, so it ends with the tab.
 * One record per channel holds the channel draft, each thread's draft and the sends the server has not
 * confirmed yet (with their nonces, so retrying after a reload cannot post twice). Cleared on sign-out
 * (`clearChannelDrafts`) and, per draft, after a successful send.
 */
export const CHANNEL_DRAFT_PREFIX = "ttv-channel-drafts:";
/** Thread drafts kept per channel; the least recently edited go first. */
export const MAX_DRAFT_SCOPES = 20;
/** Unconfirmed sends kept per channel. */
export const MAX_STORED_SENDS = 20;
const MAX_STORED = 262_144;

export const ROOT_SCOPE = "root";
/** The draft slot for a channel (`parentId` null) or one thread. */
export const draftScope = (parentId: IdType | null) => parentId === null ? ROOT_SCOPE : `thread:${parentId}`;

export interface ChannelDraft {
  body: string;
  embeds: readonly EmbedRef[];
  updatedAt: number;
}
export interface StoredSend {
  clientNonce: string;
  parentId: IdType | null;
  body: string;
  embeds: readonly EmbedRef[];
  createdAt: number;
}
export interface ChannelDraftRecord {
  drafts: Readonly<Record<string, ChannelDraft>>;
  sends: readonly StoredSend[];
}
export const EMPTY_RECORD: ChannelDraftRecord = { drafts: {}, sends: [] };

// In-progress text may be blank, but stored data is bounded and stripped of unknown keys.
const Body = z.string().max(10_000);
const Embeds = z.array(EmbedRef).max(5);
const Scope = z.string().regex(/^(root|thread:.+)$/).max(300);
const StoredRecord = z.object({
  drafts: z.record(Scope, z.object({ body: Body, embeds: Embeds, updatedAt: Timestamp })),
  sends: z.array(z.object({
    clientNonce: ClientNonce, parentId: Id.nullable(), body: MarkdownBody, embeds: Embeds, createdAt: Timestamp,
  })).max(MAX_STORED_SENDS),
});

/** One key per user and channel, so a second account in the same tab never sees the first one's text. */
export function channelDraftKey(userId: IdType, channelId: IdType): string {
  return `${CHANNEL_DRAFT_PREFIX}${encodeURIComponent(userId)}:${encodeURIComponent(channelId)}`;
}

const remove = (storage: DraftStorage, key: string) => {
  try { storage.removeItem(key); } catch { /* Storage is optional. */ }
};

export function readChannelDrafts(storage: DraftStorage | undefined, key: string): ChannelDraftRecord {
  if (!storage) return EMPTY_RECORD;
  try {
    const raw = storage.getItem(key);
    if (!raw) return EMPTY_RECORD;
    // Reject oversized or corrupt data before trusting it, and drop it so it can't linger.
    const parsed = raw.length <= MAX_STORED ? StoredRecord.safeParse(JSON.parse(raw)) : undefined;
    if (parsed?.success) return parsed.data;
  } catch { /* Corrupt JSON is removed below. */ }
  remove(storage, key);
  return EMPTY_RECORD;
}

/** Keep the newest thread drafts and sends, and drop drafts with nothing in them. */
export function boundRecord(record: ChannelDraftRecord): ChannelDraftRecord {
  const entries = Object.entries(record.drafts).filter(([, draft]) => draft.body !== "" || draft.embeds.length > 0);
  const root = entries.filter(([scope]) => scope === ROOT_SCOPE);
  const threads = entries.filter(([scope]) => scope !== ROOT_SCOPE)
    .toSorted(([, a], [, b]) => b.updatedAt - a.updatedAt)
    .slice(0, MAX_DRAFT_SCOPES);
  return { drafts: Object.fromEntries([...root, ...threads]), sends: record.sends.slice(-MAX_STORED_SENDS) };
}

/**
 * Returns false when the browser refused the write or the record exceeds what `readChannelDrafts`
 * accepts; the in-memory drafts still work. An oversized value is removed rather than left stale.
 */
export function writeChannelDrafts(storage: DraftStorage | undefined, key: string, record: ChannelDraftRecord): boolean {
  if (!storage) return false;
  try {
    const bounded = boundRecord(record);
    if (Object.keys(bounded.drafts).length === 0 && bounded.sends.length === 0) {
      storage.removeItem(key);
      return true;
    }
    const value = JSON.stringify(StoredRecord.parse(bounded));
    if (value.length > MAX_STORED) {
      storage.removeItem(key);
      return false;
    }
    storage.setItem(key, value);
    return true;
  } catch {
    // A refused write (quota) must not leave the previous record looking current.
    remove(storage, key);
    return false;
  }
}

function keysWhere(storage: DraftStorage, keep: (key: string) => boolean): string[] {
  const keys: string[] = [];
  for (let i = 0; i < storage.length; i++) {
    const key = storage.key(i);
    if (key?.startsWith(CHANNEL_DRAFT_PREFIX) && !keep(key)) keys.push(key);
  }
  return keys;
}

/** Call from the sign-out flow: removes every user's channel drafts from this tab. */
export function clearChannelDrafts(storage: DraftStorage | undefined = sessionDraftStorage()): void {
  if (!storage) return;
  try { for (const key of keysWhere(storage, () => false)) storage.removeItem(key); }
  catch { /* Storage is optional. */ }
}

/**
 * Remove drafts that belong to anyone but `userId`. A different account in this tab means the
 * previous one signed out, even if the sign-out flow could not clear them.
 */
export function clearOtherUsersChannelDrafts(storage: DraftStorage | undefined, userId: IdType): void {
  if (!storage) return;
  const own = `${CHANNEL_DRAFT_PREFIX}${encodeURIComponent(userId)}:`;
  try { for (const key of keysWhere(storage, candidate => candidate.startsWith(own))) storage.removeItem(key); }
  catch { /* Storage is optional. */ }
}
