export const AGENT_SESSION_PREFIX = "ttv-agent:";
export const AGENT_SESSION_DURATIONS = [1, 8, 24, 168] as const;

type AgentSessionDuration = (typeof AGENT_SESSION_DURATIONS)[number];

interface AgentSessionRow {
  id: string;
  expiresAt: number;
  userAgent: string;
  createdAt: number;
}

export interface AgentSessionSummary {
  id: string;
  label: string;
  expiresAt: Date;
  createdAt: Date;
}

export interface CreatedAgentSession extends AgentSessionSummary {
  token: string;
}

interface CreateAgentSessionOptions {
  db: D1Database;
  userId: string;
  label: string;
  durationHours: AgentSessionDuration;
  now?: Date;
  cryptoImpl?: Pick<Crypto, "getRandomValues" | "randomUUID">;
}

export function isAgentAuthEnabled(value: string | undefined): boolean {
  return value === "true";
}

export function isAgentSession(userAgent: string | null | undefined): boolean {
  return userAgent?.startsWith(AGENT_SESSION_PREFIX) ?? false;
}

export function normalizeAgentSessionLabel(value: string): string {
  const label = value.trim().replace(/\s+/g, " ");
  if (!label || label.length > 50) {
    throw new Error("Agent label must be between 1 and 50 characters.");
  }
  if (!/^[a-zA-Z0-9][a-zA-Z0-9 ._-]*$/.test(label)) {
    throw new Error(
      "Agent label may contain letters, numbers, spaces, dots, underscores, and hyphens."
    );
  }
  return label;
}

export function parseAgentSessionDuration(
  value: FormDataEntryValue | null
): AgentSessionDuration {
  const hours = Number(value);
  if (!AGENT_SESSION_DURATIONS.includes(hours as AgentSessionDuration)) {
    throw new Error("Choose a supported agent session duration.");
  }
  return hours as AgentSessionDuration;
}

export function isSameOriginRequest(request: Request): boolean {
  const origin = request.headers.get("origin");
  if (!origin) return false;

  try {
    return new URL(origin).origin === new URL(request.url).origin;
  } catch {
    return false;
  }
}

function createToken(cryptoImpl: Pick<Crypto, "getRandomValues">): string {
  const bytes = cryptoImpl.getRandomValues(new Uint8Array(32));
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

function toSummary(row: AgentSessionRow): AgentSessionSummary {
  return {
    id: row.id,
    label: row.userAgent.slice(AGENT_SESSION_PREFIX.length),
    expiresAt: new Date(row.expiresAt * 1_000),
    createdAt: new Date(row.createdAt * 1_000),
  };
}

export async function createAgentSession({
  db,
  userId,
  label: untrustedLabel,
  durationHours,
  now = new Date(),
  cryptoImpl = globalThis.crypto,
}: CreateAgentSessionOptions): Promise<CreatedAgentSession> {
  if (!userId) throw new Error("An authenticated user is required.");
  const label = normalizeAgentSessionLabel(untrustedLabel);
  if (!AGENT_SESSION_DURATIONS.includes(durationHours)) {
    throw new Error("Choose a supported agent session duration.");
  }

  const token = createToken(cryptoImpl);
  const id = cryptoImpl.randomUUID();
  const createdAt = new Date(now);
  const expiresAt = new Date(now.getTime() + durationHours * 60 * 60 * 1_000);

  await db
    .prepare(
      `INSERT INTO "session"
        ("id", "expiresAt", "token", "ipAddress", "userAgent", "userId", "createdAt", "updatedAt")
       VALUES (?, ?, ?, NULL, ?, ?, ?, ?)`
    )
    .bind(
      id,
      Math.floor(expiresAt.getTime() / 1_000),
      token,
      `${AGENT_SESSION_PREFIX}${label}`,
      userId,
      Math.floor(createdAt.getTime() / 1_000),
      Math.floor(createdAt.getTime() / 1_000)
    )
    .run();

  return { id, label, token, createdAt, expiresAt };
}

export async function listAgentSessions(
  db: D1Database,
  userId: string
): Promise<AgentSessionSummary[]> {
  const result = await db
    .prepare(
      `SELECT "id", "expiresAt", "userAgent", "createdAt"
       FROM "session"
       WHERE "userId" = ? AND "userAgent" LIKE ?
       ORDER BY "createdAt" DESC`
    )
    .bind(userId, `${AGENT_SESSION_PREFIX}%`)
    .all<AgentSessionRow>();

  return result.results.map(toSummary);
}

export async function revokeAgentSession(
  db: D1Database,
  userId: string,
  sessionId: string
): Promise<boolean> {
  if (!sessionId) return false;
  const result = await db
    .prepare(
      `DELETE FROM "session"
       WHERE "id" = ? AND "userId" = ? AND "userAgent" LIKE ?`
    )
    .bind(sessionId, userId, `${AGENT_SESSION_PREFIX}%`)
    .run();
  return result.meta.changes > 0;
}
