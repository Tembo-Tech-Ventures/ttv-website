import { createId } from "@paralleldrive/cuid2";
import type { RecordingViewer } from "@/lib/recordings/access";
import { goneRecordings, goneRecordingsSql, messageForReader } from "./stored-sources";

export interface ChatSessionSummary {
  id: string;
  title: string;
  createdAt: number;
  updatedAt: number;
  messageCount: number;
  latestMessage: string | null;
}

export interface StoredChatMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
  citations: unknown[];
  createdAt: number;
}

const MAX_TITLE_LENGTH = 72;

function normalizeSqliteTimestamp(value: unknown) {
  if (value instanceof Date) return Math.floor(value.getTime() / 1_000);
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string") {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : 0;
  }
  return 0;
}

function safeParseCitations(citations: unknown) {
  if (typeof citations !== "string" || !citations.trim()) return [];
  try {
    const parsed = JSON.parse(citations);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export function buildChatTitle(message: string) {
  const compact = message.replace(/\s+/g, " ").trim();
  if (!compact) return "New discussion";
  if (compact.length <= MAX_TITLE_LENGTH) return compact;
  return `${compact.slice(0, MAX_TITLE_LENGTH - 1).trimEnd()}…`;
}

export function createChatSessionId() {
  return createId();
}

/**
 * The conversation a question is asked in: one the user already owns, or a new
 * one that is only written to the database together with its first exchange.
 */
export type ChatSessionTarget =
  | { kind: "existing"; id: string }
  | { kind: "new"; id: string; title: string };

/** Empty conversations younger than this may still belong to a request in flight. */
export const ORPHANED_CHAT_SESSION_AGE_SECONDS = 10 * 60;

export async function resolveOwnedChatSession(
  db: D1Database,
  userId: string,
  sessionId: string | null | undefined,
  firstMessage: string
): Promise<ChatSessionTarget> {
  if (sessionId) {
    const existing = await db
      .prepare(
        `SELECT "id"
         FROM "chat_session"
         WHERE "id" = ? AND "userId" = ?
         LIMIT 1`
      )
      .bind(sessionId, userId)
      .first<{ id: string }>();
    if (existing) return { kind: "existing", id: existing.id };
  }

  return { kind: "new", id: createChatSessionId(), title: buildChatTitle(firstMessage) };
}

export interface ChatExchange {
  question: string;
  answer: string;
  citations: unknown[];
}

/**
 * Saves one answered question in a single D1 batch (one transaction), so a new
 * conversation never exists without its messages and a request that fails
 * before this point leaves nothing behind. Saving a new conversation also
 * removes the user's empty ones, left by failed requests before this was atomic.
 * (A tab opened before this release could still be asking in such an empty
 * conversation; if it is removed meanwhile, that request fails its foreign key,
 * writes nothing, and the next try starts a new conversation.)
 */
export async function saveChatExchange(
  db: D1Database,
  userId: string,
  target: ChatSessionTarget,
  exchange: ChatExchange
) {
  const insertMessage = db.prepare(
    `INSERT INTO "chat_message" ("id", "sessionId", "userId", "role", "content", "citations")
     VALUES (?, ?, ?, ?, ?, ?)`
  );
  const messages = [
    insertMessage.bind(createId(), target.id, userId, "user", exchange.question, null),
    insertMessage.bind(
      createId(),
      target.id,
      userId,
      "assistant",
      exchange.answer,
      JSON.stringify(exchange.citations)
    ),
  ];

  if (target.kind === "existing") {
    await db.batch([
      ...messages,
      db
        .prepare(
          `UPDATE "chat_session"
           SET "updatedAt" = unixepoch()
           WHERE "id" = ? AND "userId" = ?`
        )
        .bind(target.id, userId),
    ]);
    return;
  }

  await db.batch([
    db
      .prepare(
        `DELETE FROM "chat_session"
         WHERE "userId" = ?
           AND "createdAt" < unixepoch() - ?
           AND NOT EXISTS (
             SELECT 1 FROM "chat_message" cm WHERE cm."sessionId" = "chat_session"."id"
           )`
      )
      .bind(userId, ORPHANED_CHAT_SESSION_AGE_SECONDS),
    db
      .prepare(
        `INSERT INTO "chat_session" ("id", "userId", "title")
         VALUES (?, ?, ?)`
      )
      .bind(target.id, userId, target.title),
    ...messages,
  ]);
}


/**
 * A conversation's latest message, for its preview: [content, role, the recordings it drew on that the
 * owner may no longer read]. `where` picks the conversation's messages under the alias `latest`.
 */
const latestOf = (viewer: RecordingViewer, userId: string, where: string) => `(
           SELECT json_array(latest."content", latest."role", ${goneRecordingsSql(viewer, userId, `latest."citations"`)})
           FROM "chat_message" latest
           WHERE ${where}
           ORDER BY latest."createdAt" DESC
           LIMIT 1
         )`;

/** latestOf's preview, withheld as getChatMessages withholds the message itself. */
function previewOf(value: unknown): string | null {
  if (typeof value !== "string") return null;
  try {
    const [content, role, gone] = JSON.parse(value) as unknown[];
    if (typeof content !== "string" || typeof role !== "string") return null;
    const recordings = goneRecordings(gone);
    // goneRecordingsSql names only recordings this very message drew on.
    return messageForReader({ role, content, citations: [...recordings].map((recordingId) => ({ recordingId })) }, recordings).content;
  } catch {
    return null;
  }
}

/**
 * The owner's conversations, newest first, each previewed by its latest message. `viewer` is the
 * owner's recording access (capabilitiesFor): an answer that drew on a recording they may no longer
 * read is never previewed (stored-sources.ts).
 */
export async function listChatSessions(db: D1Database, userId: string, viewer: RecordingViewer) {
  const result = await db
    .prepare(
      `SELECT
         cs."id",
         cs."title",
         cs."createdAt",
         cs."updatedAt",
         COUNT(cm."id") AS "messageCount",
         ${latestOf(viewer, userId, `latest."sessionId" = cs."id"`)} AS "latestMessage"
       FROM "chat_session" cs
       -- An inner join: a conversation without messages is one a failed request
       -- left behind, and there is nothing in it to show.
       JOIN "chat_message" cm ON cm."sessionId" = cs."id"
       WHERE cs."userId" = ?
       GROUP BY cs."id"
       ORDER BY cs."updatedAt" DESC
       LIMIT 30`
    )
    .bind(userId)
    .all<Record<string, unknown>>();

  const sessions = (result.results ?? []).map((row) => ({
    id: String(row.id),
    title: String(row.title),
    createdAt: normalizeSqliteTimestamp(row.createdAt),
    updatedAt: normalizeSqliteTimestamp(row.updatedAt),
    messageCount: Number(row.messageCount ?? 0),
    latestMessage: previewOf(row.latestMessage),
  }));

  const legacy = await db
    .prepare(
      `SELECT
         COUNT(*) AS "messageCount",
         MAX("createdAt") AS "updatedAt",
         ${latestOf(viewer, userId, `latest."userId" = ? AND latest."sessionId" IS NULL`)} AS "latestMessage"
       FROM "chat_message"
       WHERE "userId" = ? AND "sessionId" IS NULL`
    )
    .bind(userId, userId)
    .first<Record<string, unknown>>();

  if (legacy && Number(legacy.messageCount ?? 0) > 0) {
    sessions.push({
      id: "legacy",
      title: "Earlier discussion",
      createdAt: normalizeSqliteTimestamp(legacy.updatedAt),
      updatedAt: normalizeSqliteTimestamp(legacy.updatedAt),
      messageCount: Number(legacy.messageCount ?? 0),
      latestMessage: previewOf(legacy.latestMessage),
    });
  }

  return sessions satisfies ChatSessionSummary[];
}

/**
 * An owned conversation's messages, oldest first, or null when it isn't the owner's. Each answer is
 * checked again against `viewer`, the owner's recording access (capabilitiesFor), in the same
 * statement: one that drew on a recording they may no longer read is withheld (stored-sources.ts).
 */
export async function getChatMessages(
  db: D1Database,
  userId: string,
  sessionId: string,
  viewer: RecordingViewer
) {
  if (sessionId !== "legacy") {
    const session = await db
      .prepare(
        `SELECT "id"
         FROM "chat_session"
         WHERE "id" = ? AND "userId" = ?
         LIMIT 1`
      )
      .bind(sessionId, userId)
      .first<{ id: string }>();
    if (!session) return null;
  }

  const whereClause =
    sessionId === "legacy"
      ? `"userId" = ? AND "sessionId" IS NULL`
      : `"userId" = ? AND "sessionId" = ?`;
  const statement = db.prepare(
    `SELECT "id", "role", "content", "citations", "createdAt",
       CASE WHEN "role" = 'assistant' THEN ${goneRecordingsSql(viewer, userId, `"chat_message"."citations"`)} END AS "goneRecordings"
     FROM "chat_message"
     WHERE ${whereClause}
     ORDER BY "createdAt" ASC
     LIMIT 100`
  );
  const result =
    sessionId === "legacy"
      ? await statement.bind(userId).all<Record<string, unknown>>()
      : await statement.bind(userId, sessionId).all<Record<string, unknown>>();

  return (result.results ?? [])
    .filter((row) => row.role === "user" || row.role === "assistant")
    .map((row) => messageForReader({
      id: String(row.id),
      role: row.role as "user" | "assistant",
      content: String(row.content ?? ""),
      citations: safeParseCitations(row.citations),
      createdAt: normalizeSqliteTimestamp(row.createdAt),
    }, goneRecordings(row.goneRecordings))) satisfies StoredChatMessage[];
}
