import { memberProfileHref } from "@/lib/members/links";
import { publicProfileEligibility, postedWorkEligibility, memberEligibility } from "@/lib/community/eligibility";
import type { ToolDefinition } from "@/lib/ai/gateway";
import { bodyForReader } from "@/lib/channels/moderation/mask";
import { NonEmptyText, type ChannelKind, type Citation, type TemboScope } from "@/lib/platform/contracts";
import { channelPagePath } from "@/lib/platform/server/space-routes";
import { resolvePublicProfileIdentity } from "@/lib/talent/public-identity";
import { formatTimestamp } from "@/lib/recordings/time-utils";
import { TEMBO_CONFIG } from "./config";
import { mentionsTembo } from "./mention";

/**
 * What Tembo may read to answer in a channel (README.md beside this file, "What Tembo sees"). The
 * channel alone decides it, never the person asking, because the answer is posted where every reader
 * of the channel sees it: an admin asking in a cohort channel reaches no more than its members do.
 *
 * | Channel   | Sources |
 * |-----------|---------|
 * | COHORT    | That program's session transcripts, and this channel's messages |
 * | COMMUNITY | Saved member profiles and their posted work, projects their owners shared in this channel, and this channel's messages. Never recordings |
 * | DIRECT    | This conversation's messages only |
 *
 * Messages are read as a reader without privileges reads them: nobody's deleted or hidden messages,
 * no replies under a hidden message, nothing Tembo wrote, and contact details masked wherever a
 * flag masks them (moderation/mask.ts, `bodyForReader`), so Tembo never sees a masked span. Every
 * source is registered in a SourceBook under a tag (S1, S2, …); an answer may cite only those.
 */

export interface TemboChannel { id: string; kind: ChannelKind; slug: string; programId: string | null }

export interface Source { key: string; citation: Citation; text: string }

const identity = (citation: Citation) => {
  switch (citation.type) {
    case "message": return `message:${citation.messageId}`;
    case "sessionClip": return `session:${citation.recordingId}:${citation.startSeconds}`;
    case "project": return `project:${citation.journeyId}:${citation.version}`;
    case "profile": return `profile:${citation.userId}`;
  }
};

/** Every source one answer was given, by tag. A source given twice keeps its first tag. */
export class SourceBook {
  readonly #byKey = new Map<string, Source>();
  readonly #byIdentity = new Map<string, string>();

  /** The source's tag, or null once the book holds TEMBO_CONFIG.maxSources. */
  add(citation: Citation, text: string): string | null {
    const known = this.#byIdentity.get(identity(citation));
    if (known) return known;
    if (this.#byKey.size >= TEMBO_CONFIG.maxSources) return null;
    const key = `S${this.#byKey.size + 1}`;
    this.#byKey.set(key, { key, citation, text });
    this.#byIdentity.set(identity(citation), key);
    return key;
  }

  get(key: string): Source | undefined {
    return this.#byKey.get(key);
  }

  get size(): number {
    return this.#byKey.size;
  }

  /** Every text the model was given, for the leakage tests. */
  texts(): string[] {
    return [...this.#byKey.values()].map((source) => source.text);
  }
}

/** At most `limit` characters, whitespace folded, with an ellipsis when cut. */
export function clip(text: string, limit: number = TEMBO_CONFIG.sourceChars): string {
  const clean = text.replace(/\s+/g, " ").trim();
  return clean.length <= limit ? clean : `${clean.slice(0, limit - 1).trimEnd()}…`;
}

function title(text: string, fallback: string): string {
  const parsed = NonEmptyText.safeParse(clip(text, 200));
  return parsed.success ? parsed.data : fallback;
}

/** A message's place: its channel page, opened on its thread when it is a reply. */
export function messageHref(channel: TemboChannel, messageId: string, parentId: string | null): string {
  const params = new URLSearchParams(parentId === null ? { message: messageId } : { thread: parentId, message: messageId });
  return `${channelPagePath(channel)}?${params}`;
}

/** A message as a reader without privileges sees it. */
export interface MessageRow {
  id: string; parentId: string | null; seq: number; authorName: string | null; body: string;
  moderationState: "VISIBLE" | "FLAGGED"; moderationReasons: string;
  /** 1 when someone asked Tembo about this message: a question, never evidence (QA3-01). */
  asked: number;
}

const reasonsOf = (text: string): string[] => {
  try {
    const value: unknown = JSON.parse(text);
    return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
  } catch { return []; }
};

/** The body with every span a flag masks replaced: Tembo is never privileged. */
export const visibleBody = (row: Pick<MessageRow, "body" | "moderationState" | "moderationReasons">) =>
  bodyForReader({ body: row.body, moderationState: row.moderationState, reasons: reasonsOf(row.moderationReasons) }, false);

/**
 * The messages of channel ?1 anyone may read: a person's (not Tembo's), neither deleted nor hidden,
 * and not a reply under a hidden message. `m` is channel_message.
 */
export const READABLE_MESSAGE = `m.channelId = ?1 AND m.authorKind = 'USER' AND m.deletedAt IS NULL AND m.moderationState <> 'HIDDEN'
  AND NOT EXISTS (SELECT 1 FROM channel_message p WHERE p.id = m.parentId AND p.channelId = m.channelId AND p.moderationState = 'HIDDEN')`;
/** Someone asked Tembo about message m. */
const ASKED = `EXISTS (SELECT 1 FROM tembo_ask a WHERE a.messageId = m.id)`;
/**
 * A question to Tembo: asked about, or addressed to @tembo (a mention refused for the day was never
 * asked). It says what someone wants to know, never what is so, so it is context, not a source.
 */
const isQuestion = (row: MessageRow) => row.asked === 1 || mentionsTembo(row.body);
/**
 * No "@tembo" in m's body, apart from TTV's own addresses (@tembotech…), so questions refused for the
 * day can't fill a search's page before the exact check (mentionsTembo) runs. Still broader than a
 * mention: name@tembo.org is left out too.
 */
const NO_MENTION = `instr(replace(lower(m.body), '@tembotech', ''), '@tembo') = 0`;
const MESSAGE_COLUMNS = `m.id, m.parentId, m.seq, u.name AS authorName, m.body, m.moderationState, m.moderationReasons, ${ASKED} AS asked`;

/** Characters of a message's own words in its citation's title, so two of one person's messages tell apart. */
const EXCERPT_CHARS = 60;

const authorOf = (name: string | null) => name?.trim() || "A former member";

function addMessage(book: SourceBook, channel: TemboChannel, row: MessageRow): { key: string; text: string } | null {
  const author = authorOf(row.authorName);
  const body = visibleBody(row);
  const text = `${author}: ${clip(body)}`;
  const key = book.add({
    type: "message", messageId: row.id, channelId: channel.id,
    title: title(`${author}: “${clip(body, EXCERPT_CHARS)}”`, `Message from ${title(author, "a member")}`),
    href: messageHref(channel, row.id, row.parentId),
  }, text);
  return key ? { key, text } : null;
}

/** How a question to Tembo appears in the conversation: as context, under no tag, so nothing can cite it. */
export const QUESTION_MARK = "[question, not a source]";

/**
 * The conversation the question was asked in, oldest first: in a thread, its root and latest replies
 * before the question (the root always); otherwise the channel's latest messages before it. One read.
 * Earlier questions to Tembo come as context under QUESTION_MARK, never as tagged sources (QA3-01).
 */
export async function conversationSources(
  { db, book, channel }: SourceContext, question: { id: string; parentId: string | null; seq: number },
): Promise<string[]> {
  const where = question.parentId === null ? "m.parentId IS NULL" : "(m.id = ?3 OR m.parentId = ?3)";
  const { results } = await db.prepare(`SELECT ${MESSAGE_COLUMNS} FROM channel_message m LEFT JOIN "user" u ON u.id = m.authorId
    WHERE ${READABLE_MESSAGE} AND m.seq < ?2 AND ${where} ORDER BY m.id IS ?3 DESC, m.seq DESC LIMIT ?4`)
    .bind(channel.id, question.seq, question.parentId, TEMBO_CONFIG.contextMessages + 1).all<MessageRow>();
  // The thread's root always comes first; then the latest replies, oldest first.
  return results.toSorted((a, b) => a.seq - b.seq).flatMap((row) => {
    if (isQuestion(row)) return [`${QUESTION_MARK} ${authorOf(row.authorName)}: ${clip(visibleBody(row))}`];
    const added = addMessage(book, channel, row);
    return added ? [`[${added.key}] ${added.text}`] : [];
  });
}

const STOP_WORDS = new Set(("the and for with what how about did does was were this that from have you our who when where why which "
  + "can could would should tell there their they them are any all its it's into your ask tembo").split(" "));

/** Up to eight distinct lowercase words of a tool's query, without stop words. */
export function queryTerms(query: string): string[] {
  const words = query.normalize("NFKC").toLowerCase().match(/[\p{L}\p{N}][\p{L}\p{N}+#.-]*/gu) ?? [];
  return [...new Set(words.map((word) => word.replace(/[.-]+$/u, "")).filter((word) => word.length >= 2 && !STOP_WORDS.has(word)))].slice(0, 8);
}

/** Matches any term: each a quoted FTS5 string (FTS5 syntax stays text), longer ones also as prefixes. */
function anyTermMatch(terms: readonly string[]): string {
  return terms.map((term) => `"${term.replaceAll('"', '""')}"${term.length >= 3 ? "*" : ""}`).join(" OR ");
}

/** How many terms a text contains, as SQL over json_each(?termsParam). */
const score = (text: string, terms: string) => `(SELECT COUNT(*) FROM json_each(${terms}) t WHERE instr(lower(${text}), t.value) > 0)`;

interface ToolResult { source: string; kind: string; title: string; text: string; at?: string }
/**
 * What a tool reads with: the database, the answer's sources, the channel that decides them and the
 * question being answered, which is never one of its own sources (QA3-01).
 */
export interface SourceContext { db: D1Database; book: SourceBook; channel: TemboChannel; questionId: string }
type Search = (ctx: SourceContext, terms: string[]) => Promise<ToolResult[]>;

/**
 * This channel's messages matching the terms. Questions to Tembo are left out, the one being answered
 * and everyone else's: a question repeats what someone wants to know, so an answer citing one would
 * look grounded while saying nothing (QA3-01). Tembo's own answers are never read (READABLE_MESSAGE).
 */
const searchChannel: Search = async ({ db, book, channel, questionId }, terms) => {
  // The index holds whole bodies. A message whose terms matched only inside a masked span is dropped.
  const { results } = await db.prepare(`SELECT ${MESSAGE_COLUMNS}
    FROM channel_message_fts f CROSS JOIN channel_message_search s ON s.id = f.rowid
    CROSS JOIN channel_message m ON m.id = s.messageId LEFT JOIN "user" u ON u.id = m.authorId
    WHERE channel_message_fts MATCH ?2 AND ${READABLE_MESSAGE} AND m.id <> ?4 AND NOT ${ASKED} AND ${NO_MENTION}
    ORDER BY f.rank LIMIT ?3`)
    .bind(channel.id, anyTermMatch(terms), TEMBO_CONFIG.resultsPerTool * 2, questionId).all<MessageRow>();
  return results.filter((row) => {
    if (isQuestion(row)) return false;
    const visible = visibleBody(row).toLowerCase();
    return visible === row.body.toLowerCase() || terms.some((term) => visible.includes(term));
  }).slice(0, TEMBO_CONFIG.resultsPerTool).flatMap((row) => {
    const added = addMessage(book, channel, row);
    return added ? [{ source: added.key, kind: "message", title: "Message in this channel", text: added.text }] : [];
  });
};

interface SegmentRow { recordingId: string; title: string; startTime: number; text: string }

/** The program's newest complete sessions, segments ranked by how many terms they contain, with the two after each. */
const searchSessions: Search = async ({ db, book, channel }, terms) => {
  if (channel.kind !== "COHORT" || channel.programId === null) return [];
  const { results } = await db.prepare(`WITH recent AS MATERIALIZED (
      SELECT id, title FROM recording WHERE programId = ?1 AND processingStatus = 'complete'
      ORDER BY coalesce(recordedAt, createdAt) DESC, id LIMIT ?2),
    hits AS (SELECT s.recordingId, r.title, s.startTime, ${score("s.text", "?3")} AS score
      FROM recent r CROSS JOIN transcript_segment s WHERE s.recordingId = r.id AND s.startTime >= 0)
    SELECT h.recordingId, h.title, h.startTime, (SELECT group_concat(x.text, ' ') FROM (SELECT text FROM transcript_segment
        WHERE recordingId = h.recordingId AND startTime >= h.startTime ORDER BY startTime, id LIMIT 3) x) AS text
    FROM hits h WHERE h.score > 0 ORDER BY h.score DESC, h.recordingId, h.startTime LIMIT ?4`)
    .bind(channel.programId, TEMBO_CONFIG.recordings, JSON.stringify(terms), TEMBO_CONFIG.resultsPerTool).all<SegmentRow>();
  return results.flatMap((row) => {
    const start = Math.max(0, Math.floor(row.startTime));
    const name = title(row.title, "Session recording");
    const text = clip(row.text);
    // The moment is in the title, so two clips of one session tell apart (QA3-02).
    const key = book.add({
      type: "sessionClip", recordingId: row.recordingId, startSeconds: start, title: title(`${name} at ${formatTimestamp(start)}`, name),
      href: `/dashboard/sessions/${encodeURIComponent(row.recordingId)}?t=${start}`,
    }, text);
    return key ? [{ source: key, kind: "session", title: name, at: formatTimestamp(start), text }] : [];
  });
};

interface ProfileRow { onPublicSite:number; userId: string; handle: string; publicName: string | null; publicAvatarUrl: string | null; doc: string }
interface SharedRow {
  journeyId: string; version: number; title: string; summary: string; messageId: string; parentId: string | null;
  /** The owner who shared it, by the name this channel shows on their message. */
  builderName: string | null;
}

/**
 * Saved member profiles and their posted work, and projects their owners shared in this channel as the channel saw them,
 * while the owner still shares them, with the builder's name as the channel shows it on the sharing
 * message (QA3-06): only the owner's own share counts, so the name is never more than readers see.
 * Held work and drafts stay out.
 */
const searchProjects: Search = async ({ db, book, channel }, terms) => {
  if (channel.kind !== "COMMUNITY") return [];
  const json = JSON.stringify(terms);
  const { results: profiles } = await db.prepare(`WITH profiles AS (SELECT p.userId, p.handle, coalesce(p.publicName,(SELECT name FROM user WHERE id=p.userId)) AS publicName, p.publicAvatarUrl, ${publicProfileEligibility("p")} AS onPublicSite,
      coalesce(p.headline, '') || ' ' || coalesce(p.bio, '') || ' ' || coalesce(p.skills, '') || ' ' || coalesce((
        SELECT group_concat(coalesce(h.repoFullName,h.title) || ' ' || coalesce(h.blurb, h.description, '') || ' ' || coalesce(h.language, ''), '; ')
        FROM communityJourney h WHERE h.userId = p.userId AND ${postedWorkEligibility("h")}), '') AS doc
      FROM studentProfile p WHERE ${memberEligibility("p.userId")})
    SELECT userId, handle, publicName, publicAvatarUrl, onPublicSite, substr(doc, 1, ?2) AS doc FROM profiles
    WHERE ${score("doc", "?1")} > 0 ORDER BY ${score("doc", "?1")} DESC, userId LIMIT ?3`)
    .bind(json, TEMBO_CONFIG.sourceChars * 2, TEMBO_CONFIG.resultsPerTool).all<ProfileRow>();
  const { results: shared } = await db.prepare(`SELECT json_extract(e.value, '$.journeyId') AS journeyId,
      json_extract(e.value, '$.version') AS version, json_extract(e.value, '$.title') AS title,
      coalesce(json_extract(e.value, '$.summary'), '') AS summary, m.id AS messageId, m.parentId, u.name AS builderName
    FROM (SELECT m.id, m.parentId, m.authorId, m.embeds FROM channel_message m WHERE ${READABLE_MESSAGE} AND m.embeds <> '[]'
      ORDER BY m.seq DESC LIMIT ?3) m LEFT JOIN "user" u ON u.id = m.authorId
    CROSS JOIN json_each(CASE WHEN json_valid(m.embeds) THEN m.embeds ELSE '[]' END) e
    WHERE json_extract(e.value, '$.type') = 'project'
      AND EXISTS (SELECT 1 FROM communityJourney j WHERE j.id = json_extract(e.value, '$.journeyId')
        AND j.userId = m.authorId AND ${postedWorkEligibility("j")})
      AND ${score("coalesce(json_extract(e.value, '$.title'), '') || ' ' || coalesce(json_extract(e.value, '$.summary'), '')", "?2")} > 0
    LIMIT ?4`).bind(channel.id, json, TEMBO_CONFIG.sharedProjectMessages, TEMBO_CONFIG.resultsPerTool).all<SharedRow>();
  const found: ToolResult[] = [];
  for (const row of profiles) {
    const name = title(resolvePublicProfileIdentity(row).name, "TTV builder");
    const text = `${name}: ${clip(row.doc)}`;
    const key = book.add({ type: "profile", userId: row.userId, title: `${name} · profile`, href: memberProfileHref(row) }, text);
    if (key) found.push({ source: key, kind: "profile", title: `${name} · profile`, text });
  }
  for (const row of shared) {
    if (typeof row.journeyId !== "string" || !Number.isInteger(row.version) || row.version < 1) continue;
    const name = title(row.title, "Shared project");
    const builder = authorOf(row.builderName);
    const label = title(`${name} by ${builder}`, name);
    const text = `${name}, built by ${builder}, who shared it here: ${clip(row.summary)}`;
    const key = book.add({ type: "project", journeyId: row.journeyId, version: row.version, title: label,
      href: messageHref(channel, row.messageId, row.parentId) }, text);
    if (key) found.push({ source: key, kind: "project", title: label, text });
  }
  return found;
};

const tool = (name: string, description: string): ToolDefinition => ({
  type: "function",
  function: {
    name, description,
    parameters: {
      type: "object",
      properties: { query: { type: "string", description: "A few keywords, not a sentence" } },
      required: ["query"],
    },
  },
});

const TOOLS = {
  search_channel: {
    definition: tool("search_channel", "Search earlier messages in this channel. Returns tagged excerpts you can cite."),
    search: searchChannel,
  },
  search_sessions: {
    definition: tool("search_sessions", "Search the transcripts of this cohort's recorded sessions. Returns tagged excerpts with timestamps you can cite."),
    search: searchSessions,
  },
  search_projects: {
    definition: tool("search_projects", "Search saved member profiles and their posted work and the projects people shared in this channel. Returns tagged summaries you can cite."),
    search: searchProjects,
  },
} as const satisfies Record<string, { definition: ToolDefinition; search: Search }>;
export type TemboToolName = keyof typeof TOOLS;

/** The tools each kind of channel offers. Nothing else can be called. */
export const TOOLS_FOR: Readonly<Record<TemboScope, readonly TemboToolName[]>> = Object.freeze({
  COHORT: ["search_sessions", "search_channel"],
  COMMUNITY: ["search_projects", "search_channel"],
  DIRECT: ["search_channel"],
});

/** What Tembo can see here, in the words the prompt and the refusal use. */
export const SCOPE_WORDS: Readonly<Record<TemboScope, string>> = Object.freeze({
  COHORT: "this cohort's recorded sessions and this channel's messages",
  COMMUNITY: "this channel's messages, saved member profiles and their posted work and projects shared here",
  DIRECT: "this conversation",
});

export interface ToolSet {
  definitions: ToolDefinition[];
  /** Runs one call: an unknown or unoffered tool, or a query with no words, gets an error, never data. */
  run(name: string, args: string): Promise<string>;
}

export function toolsFor(ctx: SourceContext): ToolSet {
  const { book, channel } = ctx;
  const offered = TOOLS_FOR[channel.kind];
  return {
    definitions: offered.map((name) => TOOLS[name].definition),
    async run(name, args) {
      if (!(offered as readonly string[]).includes(name)) return JSON.stringify({ error: `Tool not available here: ${clip(name, 60)}` });
      let query: unknown;
      try { query = (JSON.parse(args) as { query?: unknown }).query; } catch { query = undefined; }
      const terms = typeof query === "string" ? queryTerms(query.slice(0, 300)) : [];
      if (terms.length === 0) return JSON.stringify({ error: "Give a query of a few keywords." });
      if (book.size >= TEMBO_CONFIG.maxSources) return JSON.stringify({ results: [], note: "You have enough sources. Answer now." });
      const results = await TOOLS[name as TemboToolName].search(ctx, terms);
      return JSON.stringify(results.length > 0 ? { results } : { results: [], note: "Nothing matched. Try other keywords, or answer NO_ANSWER." });
    },
  };
}
