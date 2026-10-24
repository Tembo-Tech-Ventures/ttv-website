/** Synthetic staging identities are a separate, expiring trust boundary. */
export const STAGING_FIXTURE_PERSONAS = ["member", "otherMember", "mentor", "institution", "unapprovedInstitution", "admin"] as const;
export type StagingFixturePersona = (typeof STAGING_FIXTURE_PERSONAS)[number];
export interface StagingFixtureIdentity {
  runId: string;
  persona: StagingFixturePersona;
  userId: string;
  expiresAt: number;
  /** Derived from the registered source session, never request headers. */
  assessmentProbe?: true;
}
export class StagingFixtureAccessError extends Error {
  readonly status = 403;
  constructor() { super("Synthetic staging identity is invalid or expired."); }
}
interface IdentityRow {
  userId: string; sessionId: string; runId: string; persona: string;
  expiresAt: number; email: string; sessionUserId: string;
  sessionUserAgent: string | null; sessionCreatedAt: number; sessionExpiresAt: number;
}
interface ResolveOptions {
  db: D1Database;
  envName: string | undefined;
  user: { id: string; email: string };
  session: { id: string; userAgent?: string | null };
  isPat: boolean;
  now?: Date;
}
const PREFIX = "ttv-staging-fixture-";
const MARKER = "ttv-agent:synthetic-staging:";
const RUN_PATTERN = /^[a-f0-9]{24}$/;
function invalid(): never { throw new StagingFixtureAccessError(); }
function marked(user: ResolveOptions["user"], session: ResolveOptions["session"]): boolean {
  return user.id.startsWith(PREFIX) || user.email?.startsWith(PREFIX) || Boolean(session.userAgent?.startsWith(MARKER));
}
async function liveRow(db: D1Database, userId: string): Promise<IdentityRow | null> {
  try {
    return await db.prepare(`SELECT f.userId, f.sessionId, f.runId, f.persona, f.expiresAt,
      u.email, s.userId AS sessionUserId, s.userAgent AS sessionUserAgent,
      s.createdAt AS sessionCreatedAt, s.expiresAt AS sessionExpiresAt
      FROM stagingFixtureIdentity f
      JOIN "user" u ON u.id=f.userId
      JOIN "session" s ON s.id=f.sessionId AND s.userId=f.userId
      WHERE f.userId=? LIMIT 1`).bind(userId).first<IdentityRow>();
  } catch { return invalid(); }
}
function validateRow(row: IdentityRow | null, nowSeconds: number): StagingFixtureIdentity {
  if (!row) return invalid();
  const persona = STAGING_FIXTURE_PERSONAS.find(value => value === row.persona);
  if (!persona || !RUN_PATTERN.test(row.runId)) return invalid();
  const userId = `${PREFIX}${row.runId}-${persona}`;
  if (row.userId !== userId || row.sessionUserId !== userId || row.email !== `${userId}@invalid.ttv` || row.sessionUserAgent !== `${MARKER}${row.runId}`) return invalid();
  if (![row.expiresAt, row.sessionCreatedAt, row.sessionExpiresAt, nowSeconds].every(Number.isSafeInteger)) return invalid();
  if (row.sessionCreatedAt > nowSeconds || row.expiresAt <= nowSeconds || row.sessionExpiresAt <= nowSeconds || row.expiresAt > row.sessionCreatedAt + 3600) return invalid();
  return { userId, runId: row.runId, persona, expiresAt: row.expiresAt,
    ...(persona === "institution" && row.sessionId === `${userId}-assessment-session` ? { assessmentProbe: true as const } : {}) };
}
/** Only pass server-authenticated locals. Prefixes identify candidates to deny, never grant. */
export async function resolveStagingFixtureIdentity({ db, envName, user, session, isPat, now = new Date() }: ResolveOptions): Promise<StagingFixtureIdentity | null> {
  if (!marked(user, session)) return null;
  if (envName !== "staging") return invalid();
  const row = await liveRow(db, user.id);
  const identity = validateRow(row, Math.floor(now.getTime() / 1000));
  if (!row || user.id !== identity.userId || user.email !== row.email) return invalid();
  // PAT authentication was already checked on this request; its source browser
  // session still has to be live, registered, and inside the absolute time cap.
  if (!isPat && (session.id !== row.sessionId || session.userAgent !== row.sessionUserAgent)) return invalid();
  return identity;
}
/** Revalidate both actors against live registries; never grant access to real users. */
export async function verifySameRunTarget({ db, envName, actor, targetUserId, now = new Date() }: {
  db: D1Database; envName: string | undefined; actor: StagingFixtureIdentity; targetUserId: string; now?: Date;
}): Promise<StagingFixtureIdentity> {
  if (envName !== "staging") return invalid();
  const seconds = Math.floor(now.getTime() / 1000);
  const current = validateRow(await liveRow(db, actor.userId), seconds);
  if (current.runId !== actor.runId || current.persona !== actor.persona || current.expiresAt !== actor.expiresAt) return invalid();
  const target = validateRow(await liveRow(db, targetUserId), seconds);
  if (target.runId !== current.runId) return invalid();
  return target;
}
