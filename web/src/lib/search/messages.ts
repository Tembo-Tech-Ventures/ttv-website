import { readableChannelRefs, type ChannelRef } from "@/lib/channels/access";
import { DELETED_AUTHOR, TEMBO_AUTHOR } from "@/lib/channels/messages";
import { bodyForReader, masksContactDetails } from "@/lib/channels/moderation/mask";
import type { Database } from "@/lib/db/schema";
import { MASKED_CONTACT, WebLink, type AuthorSummary, type ChannelKind, type SearchMessage, type SearchQuery, type Visibility } from "@/lib/platform/contracts";
import type { PlatformCapabilities } from "@/lib/platform/server/capabilities";
import { channelPagePath } from "@/lib/platform/server/space-routes";

/**
 * Channel messages in search (README.md beside this file, "Messages"). Migration
 * 0033_channel_message_search keeps an FTS5 index over the bodies of messages that are neither
 * deleted nor hidden; this module turns a search into a safe match expression and reads the newest
 * matches in the channels channelAccessFor lets the caller read.
 */

/** Terms of a query that are matched; the rest of a very long query is ignored. */
export const MAX_MATCH_TERMS = 16;
/** Terms this long or longer also match words they begin; shorter ones match whole words only. */
export const PREFIX_MIN_LENGTH = 3;
/** An excerpt is at most this many words around the match, and never longer than EXCERPT_LENGTH. */
const EXCERPT_WORDS = 24;
export const EXCERPT_LENGTH = 280;


/**
 * The FTS5 expression for a search, or null when nothing in it can match. Every term becomes a
 * quoted string, so FTS5 syntax typed into search (quotes, AND/OR/NOT, NEAR, *, ^, column filters,
 * parentheses) is only ever text. All terms must match, each once. A term without a letter or
 * digit has no words to match and is dropped.
 */
export function messageMatchExpression(q: string): string | null {
  const terms = matchTerms(q);
  if (terms.length === 0) return null;
  return terms.map((term) => `"${term.replaceAll('"', '""')}"${[...term].length >= PREFIX_MIN_LENGTH ? "*" : ""}`).join(" ");
}

/** The terms of a search that are matched, in order. */
function matchTerms(q: string): string[] {
  // Control characters (NUL ends an FTS5 string early) separate words, like spaces.
  const words = q.replaceAll(/\p{Cc}/gu, " ").split(/\s+/u).filter((term) => /[\p{L}\p{N}]/u.test(term));
  return [...new Set(words)].slice(0, MAX_MATCH_TERMS);
}

/** Words as the index's unicode61 tokenizer sees them: letters and digits, case and accents folded. */
const tokens = (text: string) => text.normalize("NFKD").replaceAll(/\p{M}/gu, "").toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? [];

/** Whether one term matches these words as the index matches it: a phrase, its last word a prefix when long enough. */
function termMatches(words: readonly string[], term: string): boolean {
  const phrase = tokens(term);
  const prefix = [...term].length >= PREFIX_MIN_LENGTH;
  return phrase.length > 0 && words.some((_, start) => phrase.every((token, i) => {
    const word = words[start + i];
    return word !== undefined && (word === token || (prefix && i === phrase.length - 1 && word.startsWith(token)));
  }));
}

/**
 * A search result from a message whose contact details this reader sees masked (QA2-08). The index
 * holds the whole body, so a match is kept only when every term also matches what the reader can
 * see, and the excerpt is cut from the masked body: searching for a number never confirms it.
 */
function maskedHit(masked: string, q: string): string | null {
  const terms = matchTerms(q);
  const words = tokens(masked.replaceAll(MASKED_CONTACT, " "));
  if (!terms.every((term) => termMatches(words, term))) return null;
  // Whitespace-separated words, with each marker kept whole.
  const pieces = masked.split(MASKED_CONTACT).flatMap((part, i) =>
    [...i > 0 ? [MASKED_CONTACT] : [], ...part.split(/\s+/u).filter((piece) => piece !== "")]);
  const first = terms[0] ?? "";
  const at = Math.max(0, pieces.findIndex((piece) => piece !== MASKED_CONTACT && termMatches(tokens(piece), first)));
  const from = Math.max(0, at - Math.floor(EXCERPT_WORDS / 2));
  let excerpt = from > 0 ? "…" : "";
  let end = from;
  for (; end < pieces.length && end - from < EXCERPT_WORDS; end += 1) {
    const next = `${end > from ? " " : ""}${pieces[end] ?? ""}`;
    if (excerpt.length + next.length > EXCERPT_LENGTH - 1) {
      // One very long word is cut rather than dropped.
      if (end === from) excerpt += next.slice(0, EXCERPT_LENGTH - 1 - excerpt.length);
      break;
    }
    excerpt += next;
  }
  return end < pieces.length ? `${excerpt}…` : excerpt;
}

/**
 * The kinds of channel a search scope covers: none for people, projects and session moments; only
 * that cohort's channels when the search names a cohort.
 */
function scopeKinds({ scope, programId }: Pick<SearchQuery, "scope" | "programId">): ReadonlySet<ChannelKind> {
  switch (scope) {
    case "cohort": return new Set(["COHORT"]);
    case "community": return new Set(["COMMUNITY", "DIRECT"]);
    case "all": case "messages": return new Set(programId === undefined ? ["COHORT", "COMMUNITY", "DIRECT"] : ["COHORT"]);
    case "people": case "projects": case "sessionMoments": return new Set();
  }
}

const VISIBILITY: Record<ChannelKind, (slug: string) => Visibility> = {
  COHORT: (slug) => ({ kind: "COHORT", label: `#${slug} · only this cohort` }),
  COMMUNITY: (slug) => ({ kind: "COMMUNITY", label: `#${slug} · signed-in members` }),
  DIRECT: () => ({ kind: "DIRECT", label: "Private conversation · only the two of you" }),
};

interface MessageHit {
  id: string; channelId: string; parentId: string | null; createdAt: number;
  authorKind: "USER" | "TEMBO"; authorId: string | null; authorName: string | null; authorImage: string | null;
  excerpt: string;
  moderationState: "VISIBLE" | "FLAGGED"; moderationReasons: string;
  /** The whole body of a FLAGGED message, which some readers see masked; null otherwise. */
  flaggedBody: string | null;
}

/**
 * The newest messages matching every term (first indexed first; an edit keeps a message's place),
 * at most `limit`. The index drives the read: FTS5 yields matches newest first, each joins its
 * message by primary key, and the read stops at `limit` readable ones. Excerpts are plain text cut
 * from the indexed body, so no embed snapshot and no hidden or deleted text can appear; a flagged
 * message's body comes along so its contact details can be masked (maskedHit).
 */
export const MESSAGE_SEARCH = `SELECT m.id, m.channelId, m.parentId, m.createdAt, m.authorKind, m.authorId,
    u.name AS authorName, u.image AS authorImage, m.moderationState, m.moderationReasons,
    CASE WHEN m.moderationState = 'FLAGGED' THEN m.body END AS flaggedBody,
    substr(snippet(channel_message_fts, 0, '', '', '…', ${EXCERPT_WORDS}), 1, ${EXCERPT_LENGTH}) AS excerpt
  FROM channel_message_fts f
  CROSS JOIN channel_message_search s ON s.id = f.rowid
  CROSS JOIN channel_message m ON m.id = s.messageId
  LEFT JOIN "user" u ON u.id = m.authorId
  WHERE channel_message_fts MATCH ?1
    AND m.channelId IN (SELECT value FROM json_each(?2))
    AND m.deletedAt IS NULL AND m.moderationState <> 'HIDDEN'
    AND NOT EXISTS (SELECT 1 FROM channel_message p
      WHERE p.channelId = m.channelId AND p.id = m.parentId AND p.moderationState = 'HIDDEN')
  ORDER BY f.rowid DESC LIMIT ?3`;

/** The excerpt this reader sees, or null when the hit matched only details masked for them. */
function excerptFor(hit: MessageHit, privileged: boolean, q: string): string | null {
  const reasons = jsonStrings(hit.moderationReasons);
  if (privileged || hit.flaggedBody === null || !masksContactDetails({ moderationState: hit.moderationState, reasons })) return hit.excerpt;
  return maskedHit(bodyForReader({ body: hit.flaggedBody, moderationState: hit.moderationState, reasons }, false), q);
}

function jsonStrings(text: string): string[] {
  try {
    const value: unknown = JSON.parse(text);
    return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
  } catch { return []; }
}

function author(hit: MessageHit): AuthorSummary {
  if (hit.authorKind === "TEMBO") return TEMBO_AUTHOR;
  if (hit.authorId === null) return DELETED_AUTHOR;
  const avatar = WebLink.safeParse(hit.authorImage);
  // Role badges describe a person within one channel; a result list shows names only.
  return { id: hit.authorId, name: hit.authorName?.trim() || "Member", avatarUrl: avatar.success ? avatar.data : null, roleBadges: [] };
}

function href(channel: ChannelRef, hit: MessageHit): string {
  const params = new URLSearchParams(hit.parentId === null ? { message: hit.id } : { thread: hit.parentId, message: hit.id });
  return `${channelPagePath(channel)}?${params}`;
}

/**
 * Messages matching the search in channels the caller can read, newest first. The caller has
 * checked the `channels` flag and the cohort the search names. Two statements: the readable
 * channels, then the match; none when the scope covers no channels or the query has no words.
 */
export async function searchMessages(
  d1: D1Database, db: Database,
  { userId, capabilities, query, limit }: { userId: string; capabilities: PlatformCapabilities; query: SearchQuery; limit: number },
): Promise<SearchMessage[]> {
  const kinds = scopeKinds(query);
  const match = messageMatchExpression(query.q);
  if (kinds.size === 0 || match === null) return [];
  const channels = new Map((await readableChannelRefs(db, userId, capabilities)).flatMap((channel) => {
    const inScope = kinds.has(channel.kind) && (query.programId === undefined || channel.programId === query.programId);
    return inScope ? [[channel.id, channel] as const] : [];
  }));
  if (channels.size === 0) return [];
  const { results } = await d1.prepare(MESSAGE_SEARCH).bind(match, JSON.stringify([...channels.keys()]), limit).all<MessageHit>();
  return results.flatMap((hit) => {
    const channel = channels.get(hit.channelId);
    if (!channel) return [];
    const excerpt = excerptFor(hit, channel.canModerate || (hit.authorKind === "USER" && hit.authorId === userId), query.q);
    if (excerpt === null) return [];
    return [{
      id: hit.id, channelId: hit.channelId, parentId: hit.parentId, author: author(hit), excerpt,
      href: href(channel, hit), createdAt: hit.createdAt, visibility: VISIBILITY[channel.kind](channel.slug),
    }];
  });
}
