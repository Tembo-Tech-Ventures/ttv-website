import { createId } from "@paralleldrive/cuid2";

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

export async function ensureOwnedChatSession(
  db: D1Database,
  userId: string,
  sessionId: string | null | undefined,
  firstMessage: string
) {
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
    if (existing) return existing.id;
  }

  const id = createChatSessionId();
  const title = buildChatTitle(firstMessage);
  await db
    .prepare(
      `INSERT INTO "chat_session" ("id", "userId", "title")
       VALUES (?, ?, ?)`
    )
    .bind(id, userId, title)
    .run();
  return id;
}

export async function touchChatSession(
  db: D1Database,
  userId: string,
  sessionId: string
) {
  await db
    .prepare(
      `UPDATE "chat_session"
       SET "updatedAt" = unixepoch()
       WHERE "id" = ? AND "userId" = ?`
    )
    .bind(sessionId, userId)
    .run();
}

export async function listChatSessions(db: D1Database, userId: string) {
  const result = await db
    .prepare(
      `SELECT
         cs."id",
         cs."title",
         cs."createdAt",
         cs."updatedAt",
         COUNT(cm."id") AS "messageCount",
         (
           SELECT cm2."content"
           FROM "chat_message" cm2
           WHERE cm2."sessionId" = cs."id"
           ORDER BY cm2."createdAt" DESC
           LIMIT 1
         ) AS "latestMessage"
       FROM "chat_session" cs
       LEFT JOIN "chat_message" cm ON cm."sessionId" = cs."id"
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
    latestMessage: typeof row.latestMessage === "string" ? row.latestMessage : null,
  }));

  const legacy = await db
    .prepare(
      `SELECT
         COUNT(*) AS "messageCount",
         MAX("createdAt") AS "updatedAt",
         (
           SELECT "content"
           FROM "chat_message"
           WHERE "userId" = ? AND "sessionId" IS NULL
           ORDER BY "createdAt" DESC
           LIMIT 1
         ) AS "latestMessage"
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
      latestMessage:
        typeof legacy.latestMessage === "string" ? legacy.latestMessage : null,
    });
  }

  return sessions satisfies ChatSessionSummary[];
}

export async function getChatMessages(
  db: D1Database,
  userId: string,
  sessionId: string
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
    `SELECT "id", "role", "content", "citations", "createdAt"
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
    .map((row) => ({
      id: String(row.id),
      role: row.role as "user" | "assistant",
      content: String(row.content ?? ""),
      citations: safeParseCitations(row.citations),
      createdAt: normalizeSqliteTimestamp(row.createdAt),
    })) satisfies StoredChatMessage[];
}
