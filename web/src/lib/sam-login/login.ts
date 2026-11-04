import { createHmac, randomBytes } from "node:crypto";
import { getCookies } from "better-auth/cookies";
import { samLoginAuthorized, samLoginConfig, type SamLoginConfig, type SamLoginEnvironment } from "./config";
import { samKeySource, SamTokenError, verifySamToken, type KeySource, type SamClaims } from "./oidc";
import {
  isSamPersonaUserId,
  SAM_PERSONA_KEYS,
  SAM_PERSONAS,
  samPersona,
  samPersonaEmail,
  samPersonaStatements,
  samPersonaUserId,
  type SamPersona,
} from "./personas";

export interface SamLoginWorkerEnv extends SamLoginEnvironment {
  DB: D1Database;
  BETTER_AUTH_SECRET: string;
}

export interface SamLoginOptions {
  keys?: KeySource;
  now?: number;
}

/** The marker on a SAM login's session row. Not `ttv-agent:`: the persona is a browser user, not a delegated token. */
export const SAM_SESSION_MARKER = "ttv-sam-login:";
const DEFAULT_TTL_MINUTES = 60;
const MAX_TTL_MINUTES = 240;
const MIN_TTL_MINUTES = 5;
const LOGINS_PER_HOUR = 60;
const MAX_BODY_BYTES = 1024;

const defaultKeys = samKeySource();

const json = (status: number, body: unknown) => new Response(JSON.stringify(body), {
  status,
  headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
});
const notFound = () => json(404, { error: "Not found." });

class LoginRequestError extends Error {
  constructor(readonly status: number, message: string) {
    super(message);
  }
}

function bearer(request: Request): string {
  const header = request.headers.get("authorization") ?? "";
  const match = /^Bearer ([A-Za-z0-9_.-]+)$/.exec(header);
  if (!match) throw new LoginRequestError(401, "A SAM OIDC token is required as the bearer credential.");
  return match[1];
}

async function readBody(request: Request): Promise<{ persona: SamPersona; ttlMinutes: number }> {
  if (Number(request.headers.get("content-length") ?? 0) > MAX_BODY_BYTES) throw new LoginRequestError(413, "Request body is too large.");
  const text = await request.text();
  if (new TextEncoder().encode(text).length > MAX_BODY_BYTES) throw new LoginRequestError(413, "Request body is too large.");
  let body: unknown;
  try {
    body = JSON.parse(text);
  } catch {
    throw new LoginRequestError(400, "Request body must be JSON.");
  }
  if (!body || typeof body !== "object" || Array.isArray(body)) throw new LoginRequestError(400, "Request body must be a JSON object.");
  const { persona: rawPersona, ttlMinutes: rawTtl, ...rest } = body as Record<string, unknown>;
  if (Object.keys(rest).length > 0) throw new LoginRequestError(400, `Unknown fields: ${Object.keys(rest).join(", ")}.`);
  const persona = samPersona(rawPersona);
  if (!persona) throw new LoginRequestError(400, `persona must be one of: ${SAM_PERSONA_KEYS.join(", ")}.`);
  const ttlMinutes = rawTtl === undefined ? DEFAULT_TTL_MINUTES : rawTtl;
  if (typeof ttlMinutes !== "number" || !Number.isInteger(ttlMinutes) || ttlMinutes < MIN_TTL_MINUTES || ttlMinutes > MAX_TTL_MINUTES) {
    throw new LoginRequestError(400, `ttlMinutes must be a whole number from ${MIN_TTL_MINUTES} to ${MAX_TTL_MINUTES}.`);
  }
  return { persona, ttlMinutes };
}

async function verifiedOwner(config: SamLoginConfig, request: Request, options: SamLoginOptions): Promise<SamClaims> {
  let claims: SamClaims;
  try {
    claims = await verifySamToken(bearer(request), { audience: config.origin, keys: options.keys ?? defaultKeys, now: options.now });
  } catch (error) {
    if (error instanceof SamTokenError) throw new LoginRequestError(401, "The SAM OIDC token is not valid for this site.");
    throw error;
  }
  if (!samLoginAuthorized(config, claims)) throw new LoginRequestError(403, "This SAM project or user may not sign in here.");
  return claims;
}

/** Better Auth's signed cookie value: the token, a dot, and its HMAC under the auth secret. */
function signed(value: string, secret: string) {
  return encodeURIComponent(`${value}.${createHmac("sha256", secret).update(value).digest("base64")}`);
}

async function login(env: SamLoginWorkerEnv, config: SamLoginConfig, request: Request, options: SamLoginOptions) {
  const now = options.now ?? Math.floor(Date.now() / 1000);
  const claims = await verifiedOwner(config, request, options);
  const { persona, ttlMinutes } = await readBody(request);

  const recent = await env.DB.prepare(`SELECT count(*) AS n FROM staging_sam_login WHERE samUserId=? AND createdAt>?`)
    .bind(claims.userId, now - 3600).first<{ n: number }>();
  if ((recent?.n ?? 0) >= LOGINS_PER_HOUR) throw new LoginRequestError(429, "Too many SAM logins in the last hour.");
  if (await env.DB.prepare(`SELECT 1 FROM staging_sam_login WHERE jti=?`).bind(claims.jti).first()) {
    throw new LoginRequestError(401, "This SAM OIDC token has already been used.");
  }

  const loginId = randomBytes(12).toString("hex");
  const userId = samPersonaUserId(persona, loginId);
  // Never reseed, or hand out a session for, an account this mechanism doesn't own.
  const existing = await env.DB.prepare(`SELECT email FROM "user" WHERE id=?`).bind(userId).first<{ email: string }>();
  if (existing && existing.email !== samPersonaEmail(userId)) throw new LoginRequestError(409, "The persona account is not a SAM persona.");
  const sessionId = crypto.randomUUID();
  const token = randomBytes(32).toString("hex");
  const expiresAt = now + ttlMinutes * 60;
  try {
    // One batch, one transaction: the persona, its session and the login that authorizes it land together.
    await env.DB.batch([
      ...samPersonaStatements(env.DB, persona, userId, now),
      env.DB.prepare(`INSERT INTO session (id,expiresAt,token,ipAddress,userAgent,userId,createdAt,updatedAt) VALUES (?,?,?,NULL,?,?,?,?)`)
        .bind(sessionId, expiresAt, token, `${SAM_SESSION_MARKER}${loginId}`, userId, now, now),
      env.DB.prepare(`INSERT INTO staging_sam_login (id,jti,samProjectId,samUserId,samSubject,samTaskId,samWorkspaceId,samAgentSessionId,persona,userId,sessionId,createdAt,expiresAt)
        VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`)
        .bind(loginId, claims.jti, claims.projectId, claims.userId, claims.subject, claims.taskId, claims.workspaceId, claims.agentSessionId,
          persona, userId, sessionId, now, expiresAt),
    ]);
  } catch (error) {
    if (String(error).includes("UNIQUE") && String(error).includes("jti")) throw new LoginRequestError(401, "This SAM OIDC token has already been used.");
    throw error;
  }
  const url = new URL(config.origin);
  const names = getCookies({ baseURL: config.origin });
  const cookie = (name: string, value: string) => ({
    name, value, domain: url.hostname, path: "/", expires: expiresAt, httpOnly: true, secure: url.protocol === "https:", sameSite: "Lax" as const,
  });
  return json(200, {
    persona,
    summary: SAM_PERSONAS[persona].summary,
    name: SAM_PERSONAS[persona].name,
    userId,
    loginId,
    origin: config.origin,
    expiresAt: new Date(expiresAt * 1000).toISOString(),
    // Playwright's storageState cookie shape. dont_remember stops Better Auth extending the session.
    cookies: [
      cookie(names.sessionToken.name, signed(token, env.BETTER_AUTH_SECRET)),
      cookie(names.dontRememberToken.name, signed("true", env.BETTER_AUTH_SECRET)),
    ],
  });
}

async function revokeLogin(db: D1Database, loginId: string, sessionId: string, now: number) {
  await db.batch([
    db.prepare(`UPDATE staging_sam_login SET revokedAt=? WHERE id=? AND revokedAt IS NULL`).bind(now, loginId),
    db.prepare(`DELETE FROM session WHERE id=? AND userAgent=?`).bind(sessionId, `${SAM_SESSION_MARKER}${loginId}`),
  ]);
}

const NEWCOMERS_PER_REVOKE = 50;

/** The logins a revoke covers: one SAM task's (or agent session's), or every login of the SAM user. */
interface RevokeScope {
  samUserId: string;
  only: { column: "samTaskId" | "samAgentSessionId"; value: string } | null;
}

function scopeWhere(scope: RevokeScope, alias: string) {
  return scope.only
    ? { sql: `${alias}samUserId=? AND ${alias}${scope.only.column}=?`, params: [scope.samUserId, scope.only.value] }
    : { sql: `${alias}samUserId=?`, params: [scope.samUserId] };
}

async function revokeScope(request: Request, claims: SamClaims): Promise<RevokeScope> {
  const text = await request.text();
  if (new TextEncoder().encode(text).length > MAX_BODY_BYTES) throw new LoginRequestError(413, "Request body is too large.");
  let body: unknown = {};
  if (text.trim()) {
    try {
      body = JSON.parse(text);
    } catch {
      throw new LoginRequestError(400, "Request body must be JSON.");
    }
  }
  if (!body || typeof body !== "object" || Array.isArray(body)) throw new LoginRequestError(400, "Request body must be a JSON object.");
  const { all, ...rest } = body as Record<string, unknown>;
  if (Object.keys(rest).length > 0 || (all !== undefined && typeof all !== "boolean")) throw new LoginRequestError(400, "The only field is all (true or false).");
  if (all) return { samUserId: claims.userId, only: null };
  // Every agent of one SAM user shares it: scope to the caller, so one agent's cleanup never ends another's run.
  if (claims.taskId) return { samUserId: claims.userId, only: { column: "samTaskId", value: claims.taskId } };
  if (claims.agentSessionId) return { samUserId: claims.userId, only: { column: "samAgentSessionId", value: claims.agentSessionId } };
  throw new LoginRequestError(400, 'This SAM token names no task or agent session; send {"all":true} to revoke every login of the SAM user.');
}

const isForeignKeyRefusal = (error: unknown) => String(error).includes("FOREIGN KEY");

/**
 * Deletes newcomer accounts these logins created (each newcomer login makes a fresh one), up to 50
 * a call, trying only accounts that still exist. An account something still points at (a cohort
 * role) stays and is counted; any other failure is an error.
 */
async function removeNewcomers(db: D1Database, scope: RevokeScope) {
  const where = scopeWhere(scope, "l.");
  const { results } = await db.prepare(`SELECT DISTINCT l.userId FROM staging_sam_login l JOIN "user" u ON u.id = l.userId
    WHERE ${where.sql} AND l.persona='newcomer' AND u.email = l.userId || '@invalid.ttv' LIMIT ?`)
    .bind(...where.params, NEWCOMERS_PER_REVOKE).all<{ userId: string }>();
  let removed = 0;
  let kept = 0;
  for (const { userId } of results) {
    if (!userId.startsWith(samPersonaUserId("newcomer", ""))) continue;
    try {
      const result = await db.prepare(`DELETE FROM "user" WHERE id=? AND email=?`).bind(userId, samPersonaEmail(userId)).run();
      if ((result.meta.changes ?? 0) > 0) removed++;
    } catch (error) {
      if (!isForeignKeyRefusal(error)) throw error;
      kept++;
    }
  }
  return { removed, kept };
}

/** Ends the caller's live logins (see revokeScope) and removes the newcomer accounts they made. */
async function revoke(env: SamLoginWorkerEnv, config: SamLoginConfig, request: Request, options: SamLoginOptions) {
  const now = options.now ?? Math.floor(Date.now() / 1000);
  const scope = await revokeScope(request, await verifiedOwner(config, request, options));
  const where = scopeWhere(scope, "");
  const { results } = await env.DB.prepare(`SELECT id, sessionId FROM staging_sam_login WHERE ${where.sql} AND revokedAt IS NULL AND expiresAt>?`)
    .bind(...where.params, now).all<{ id: string; sessionId: string }>();
  for (const row of results) await revokeLogin(env.DB, row.id, row.sessionId, now);
  const newcomers = await removeNewcomers(env.DB, scope);
  return json(200, { revoked: results.length, newcomersRemoved: newcomers.removed, newcomersKept: newcomers.kept });
}

/**
 * POST signs in as a persona; DELETE revokes the calling task's logins (all of the SAM user's with `{"all":true}`). Both take a SAM OIDC token
 * whose audience is this site's origin. Off (404) unless samLoginConfig says it is on.
 */
export async function handleSamLogin(env: SamLoginWorkerEnv, request: Request, options: SamLoginOptions = {}): Promise<Response> {
  const config = samLoginConfig(env);
  if (!config || new URL(request.url).origin !== config.origin) return notFound();
  try {
    if (request.method === "POST") return await login(env, config, request, options);
    if (request.method === "DELETE") return await revoke(env, config, request, options);
    return notFound();
  } catch (error) {
    if (error instanceof LoginRequestError) return json(error.status, { error: error.message });
    throw error;
  }
}

export class SamLoginAccessError extends Error {
  readonly status = 403;
  constructor() {
    super("This SAM staging login is not valid any more. Sign in again with a fresh SAM OIDC token.");
  }
}

export interface SamLoginIdentity {
  loginId: string;
  persona: SamPersona;
  samUserId: string;
  samTaskId: string | null;
  expiresAt: number;
}

interface LoginRow {
  id: string;
  persona: string;
  userId: string;
  samProjectId: string;
  samUserId: string;
  samTaskId: string | null;
  expiresAt: number;
  revokedAt: number | null;
  sessionUserId: string;
  sessionUserAgent: string | null;
}

/**
 * For middleware, with server-authenticated locals only. A persona account, or a session carrying
 * the SAM marker, is accepted only through its live login row; anything else about it is refused.
 * Every other account is untouched (null).
 */
export async function resolveSamLogin({ env, user, session, viaPersonalAccessToken, now = Math.floor(Date.now() / 1000) }: {
  env: SamLoginWorkerEnv;
  user: { id: string; email: string };
  session: { id: string; userAgent?: string | null };
  viaPersonalAccessToken: boolean;
  now?: number;
}): Promise<SamLoginIdentity | null> {
  if (!isSamPersonaUserId(user.id) && !session.userAgent?.startsWith(SAM_SESSION_MARKER)) return null;
  const config = samLoginConfig(env);
  if (!config || viaPersonalAccessToken) throw new SamLoginAccessError();
  const row = await env.DB.prepare(`SELECT l.id, l.persona, l.userId, l.samProjectId, l.samUserId, l.samTaskId, l.expiresAt, l.revokedAt,
      s.userId AS sessionUserId, s.userAgent AS sessionUserAgent
    FROM staging_sam_login l JOIN session s ON s.id = l.sessionId WHERE l.sessionId=?`).bind(session.id).first<LoginRow>();
  const persona = samPersona(row?.persona);
  if (!row || !persona || row.revokedAt !== null || row.expiresAt <= now) throw new SamLoginAccessError();
  if (row.userId !== user.id || row.sessionUserId !== user.id || row.sessionUserAgent !== `${SAM_SESSION_MARKER}${row.id}`) throw new SamLoginAccessError();
  if (!isSamPersonaUserId(user.id) || user.email !== samPersonaEmail(user.id)) throw new SamLoginAccessError();
  // Taking a SAM user or project out of the configuration ends their logins at once.
  if (!samLoginAuthorized(config, { projectId: row.samProjectId, userId: row.samUserId })) throw new SamLoginAccessError();
  return { loginId: row.id, persona, samUserId: row.samUserId, samTaskId: row.samTaskId, expiresAt: row.expiresAt };
}
