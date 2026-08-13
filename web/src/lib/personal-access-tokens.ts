import { requiresAdminMutationOrigin } from "@/lib/admin/mutation-security";

export const PERSONAL_ACCESS_TOKEN_PREFIX = "ttv_pat_";
export const PERSONAL_ACCESS_TOKEN_DURATIONS = [8, 24, 168, 720] as const;
export const PERSONAL_ACCESS_TOKEN_SCOPES = [
  "admin:read",
  "admin:write",
] as const;
export const MAX_ACTIVE_PERSONAL_ACCESS_TOKENS = 10;
export const PERSONAL_ACCESS_TOKEN_WRITE_ERROR =
  "Forbidden: this personal access token does not grant admin:write.";

const TOKEN_SECRET_BYTES = 32;
const LAST_USED_WRITE_INTERVAL_SECONDS = 5 * 60;
const TOKEN_PATTERN = /^ttv_pat_[a-f0-9]{64}$/;

export type PersonalAccessTokenDuration =
  (typeof PERSONAL_ACCESS_TOKEN_DURATIONS)[number];
export type PersonalAccessTokenScope =
  (typeof PERSONAL_ACCESS_TOKEN_SCOPES)[number];

interface PersonalAccessTokenRow {
  id: string;
  tokenPrefix: string;
  label: string;
  scopes: string;
  expiresAt: number;
  lastUsedAt: number | null;
  revokedAt: number | null;
  createdAt: number;
}

interface AuthenticatedPersonalAccessTokenRow extends PersonalAccessTokenRow {
  userId: string;
  userName: string;
  userEmail: string;
  userEmailVerified: number;
  userImage: string | null;
  userCreatedAt: number;
  userUpdatedAt: number;
}

export interface PersonalAccessTokenSummary {
  id: string;
  tokenPrefix: string;
  label: string;
  scopes: PersonalAccessTokenScope[];
  expiresAt: Date;
  lastUsedAt: Date | null;
  revokedAt: Date | null;
  createdAt: Date;
}

export interface CreatedPersonalAccessToken extends PersonalAccessTokenSummary {
  token: string;
}

export interface AuthenticatedPersonalAccessToken {
  token: PersonalAccessTokenSummary;
  session: AuthSession;
  user: AuthUser;
}

interface CreatePersonalAccessTokenOptions {
  db: D1Database;
  userId: string;
  label: string;
  durationHours: PersonalAccessTokenDuration;
  scopes: PersonalAccessTokenScope[];
  now?: Date;
  cryptoImpl?: Pick<Crypto, "getRandomValues" | "randomUUID" | "subtle">;
}

export function normalizePersonalAccessTokenLabel(value: string): string {
  const label = value.trim().replace(/\s+/g, " ");
  if (!label || label.length > 50) {
    throw new Error("Token label must be between 1 and 50 characters.");
  }
  if (!/^[a-zA-Z0-9][a-zA-Z0-9 ._-]*$/.test(label)) {
    throw new Error(
      "Token label may contain letters, numbers, spaces, dots, underscores, and hyphens."
    );
  }
  return label;
}

export function parsePersonalAccessTokenDuration(
  value: FormDataEntryValue | null
): PersonalAccessTokenDuration {
  const hours = Number(value);
  if (
    !PERSONAL_ACCESS_TOKEN_DURATIONS.includes(
      hours as PersonalAccessTokenDuration
    )
  ) {
    throw new Error("Choose a supported token duration.");
  }
  return hours as PersonalAccessTokenDuration;
}

export function parsePersonalAccessTokenScopes(
  value: FormDataEntryValue | null
): PersonalAccessTokenScope[] {
  if (value === "read") return ["admin:read"];
  if (value === "write") return ["admin:read", "admin:write"];
  throw new Error("Choose read-only or read/write access.");
}

function parseStoredScopes(value: string): PersonalAccessTokenScope[] | null {
  try {
    const scopes = JSON.parse(value) as unknown;
    if (
      !Array.isArray(scopes) ||
      scopes.length === 0 ||
      scopes.some(
        (scope) =>
          typeof scope !== "string" ||
          !PERSONAL_ACCESS_TOKEN_SCOPES.includes(
            scope as PersonalAccessTokenScope
          )
      )
    ) {
      return null;
    }
    return [...new Set(scopes as PersonalAccessTokenScope[])];
  } catch {
    return null;
  }
}

function createToken(cryptoImpl: Pick<Crypto, "getRandomValues">): string {
  const bytes = cryptoImpl.getRandomValues(new Uint8Array(TOKEN_SECRET_BYTES));
  const secret = Array.from(bytes, (byte) =>
    byte.toString(16).padStart(2, "0")
  ).join("");
  return `${PERSONAL_ACCESS_TOKEN_PREFIX}${secret}`;
}

export async function hashPersonalAccessToken(
  token: string,
  cryptoImpl: Pick<Crypto, "subtle"> = globalThis.crypto
): Promise<string> {
  const digest = await cryptoImpl.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(token)
  );
  return Array.from(new Uint8Array(digest), (byte) =>
    byte.toString(16).padStart(2, "0")
  ).join("");
}

function toSummary(
  row: PersonalAccessTokenRow,
  scopes = parseStoredScopes(row.scopes)
): PersonalAccessTokenSummary | null {
  if (!scopes) return null;
  return {
    id: row.id,
    tokenPrefix: row.tokenPrefix,
    label: row.label,
    scopes,
    expiresAt: new Date(row.expiresAt * 1_000),
    lastUsedAt: row.lastUsedAt ? new Date(row.lastUsedAt * 1_000) : null,
    revokedAt: row.revokedAt ? new Date(row.revokedAt * 1_000) : null,
    createdAt: new Date(row.createdAt * 1_000),
  };
}

export async function createPersonalAccessToken({
  db,
  userId,
  label: untrustedLabel,
  durationHours,
  scopes,
  now = new Date(),
  cryptoImpl = globalThis.crypto,
}: CreatePersonalAccessTokenOptions): Promise<CreatedPersonalAccessToken> {
  if (!userId) throw new Error("An authenticated user is required.");
  const label = normalizePersonalAccessTokenLabel(untrustedLabel);
  if (!PERSONAL_ACCESS_TOKEN_DURATIONS.includes(durationHours)) {
    throw new Error("Choose a supported token duration.");
  }
  const validatedScopes = parseStoredScopes(JSON.stringify(scopes));
  if (!validatedScopes || !validatedScopes.includes("admin:read")) {
    throw new Error("Every token must include admin:read access.");
  }

  const nowSeconds = Math.floor(now.getTime() / 1_000);
  const active = await db
    .prepare(
      `SELECT COUNT(*) AS "count"
       FROM "personal_access_token"
       WHERE "userId" = ? AND "revokedAt" IS NULL AND "expiresAt" > ?`
    )
    .bind(userId, nowSeconds)
    .first<{ count: number }>();
  if (Number(active?.count ?? 0) >= MAX_ACTIVE_PERSONAL_ACCESS_TOKENS) {
    throw new Error(
      `Revoke an existing token before creating more than ${MAX_ACTIVE_PERSONAL_ACCESS_TOKENS}.`
    );
  }

  const token = createToken(cryptoImpl);
  const tokenHash = await hashPersonalAccessToken(token, cryptoImpl);
  const id = cryptoImpl.randomUUID();
  const expiresAt = new Date(
    now.getTime() + durationHours * 60 * 60 * 1_000
  );
  const tokenPrefix = `${token.slice(0, PERSONAL_ACCESS_TOKEN_PREFIX.length + 8)}…`;

  await db
    .prepare(
      `INSERT INTO "personal_access_token"
        ("id", "userId", "tokenHash", "tokenPrefix", "label", "scopes",
         "expiresAt", "lastUsedAt", "revokedAt", "createdAt", "updatedAt")
       VALUES (?, ?, ?, ?, ?, ?, ?, NULL, NULL, ?, ?)`
    )
    .bind(
      id,
      userId,
      tokenHash,
      tokenPrefix,
      label,
      JSON.stringify(validatedScopes),
      Math.floor(expiresAt.getTime() / 1_000),
      nowSeconds,
      nowSeconds
    )
    .run();

  return {
    id,
    token,
    tokenPrefix,
    label,
    scopes: validatedScopes,
    expiresAt,
    lastUsedAt: null,
    revokedAt: null,
    createdAt: new Date(now),
  };
}

export async function listPersonalAccessTokens(
  db: D1Database,
  userId: string
): Promise<PersonalAccessTokenSummary[]> {
  const result = await db
    .prepare(
      `SELECT "id", "tokenPrefix", "label", "scopes", "expiresAt",
              "lastUsedAt", "revokedAt", "createdAt"
       FROM "personal_access_token"
       WHERE "userId" = ?
       ORDER BY "createdAt" DESC
       LIMIT 50`
    )
    .bind(userId)
    .all<PersonalAccessTokenRow>();

  return result.results
    .map((row) => toSummary(row))
    .filter((row): row is PersonalAccessTokenSummary => row !== null);
}

export async function revokePersonalAccessToken(
  db: D1Database,
  userId: string,
  tokenId: string,
  now = new Date()
): Promise<boolean> {
  if (!tokenId) return false;
  const nowSeconds = Math.floor(now.getTime() / 1_000);
  const result = await db
    .prepare(
      `UPDATE "personal_access_token"
       SET "revokedAt" = ?, "updatedAt" = ?
       WHERE "id" = ? AND "userId" = ? AND "revokedAt" IS NULL`
    )
    .bind(nowSeconds, nowSeconds, tokenId, userId)
    .run();
  return (result.meta.changes ?? 0) > 0;
}

export function extractPersonalAccessToken(request: Request): string | null {
  const authorization = request.headers.get("authorization");
  if (!authorization?.startsWith("Bearer ")) return null;
  const token = authorization.slice("Bearer ".length);
  return TOKEN_PATTERN.test(token) ? token : null;
}

export function hasPersonalAccessTokenAuthorization(request: Request): boolean {
  return (
    request.headers
      .get("authorization")
      ?.startsWith(`Bearer ${PERSONAL_ACCESS_TOKEN_PREFIX}`) ?? false
  );
}

export async function authenticatePersonalAccessToken(
  db: D1Database,
  request: Request,
  now = new Date(),
  cryptoImpl: Pick<Crypto, "subtle"> = globalThis.crypto
): Promise<AuthenticatedPersonalAccessToken | null> {
  const rawToken = extractPersonalAccessToken(request);
  if (!rawToken) return null;

  const tokenHash = await hashPersonalAccessToken(rawToken, cryptoImpl);
  const nowSeconds = Math.floor(now.getTime() / 1_000);
  const row = await db
    .prepare(
      `SELECT
         pat."id", pat."tokenPrefix", pat."label", pat."scopes",
         pat."expiresAt", pat."lastUsedAt", pat."revokedAt", pat."createdAt",
         u."id" AS "userId", u."name" AS "userName",
         u."email" AS "userEmail", u."emailVerified" AS "userEmailVerified",
         u."image" AS "userImage", u."createdAt" AS "userCreatedAt",
         u."updatedAt" AS "userUpdatedAt"
       FROM "personal_access_token" pat
       JOIN "user" u ON u."id" = pat."userId"
       WHERE pat."tokenHash" = ?
         AND pat."revokedAt" IS NULL
         AND pat."expiresAt" > ?
       LIMIT 1`
    )
    .bind(tokenHash, nowSeconds)
    .first<AuthenticatedPersonalAccessTokenRow>();
  if (!row) return null;

  const summary = toSummary(row);
  if (!summary) return null;

  if (
    row.lastUsedAt === null ||
    row.lastUsedAt <= nowSeconds - LAST_USED_WRITE_INTERVAL_SECONDS
  ) {
    await db
      .prepare(
        `UPDATE "personal_access_token"
         SET "lastUsedAt" = ?, "updatedAt" = ?
         WHERE "id" = ?
           AND ("lastUsedAt" IS NULL OR "lastUsedAt" <= ?)`
      )
      .bind(
        nowSeconds,
        nowSeconds,
        row.id,
        nowSeconds - LAST_USED_WRITE_INTERVAL_SECONDS
      )
      .run();
  }

  return {
    token: { ...summary, lastUsedAt: new Date(nowSeconds * 1_000) },
    session: {
      id: `pat:${row.id}`,
      expiresAt: summary.expiresAt,
      token: "[personal-access-token]",
      ipAddress: null,
      userAgent: `ttv-pat:${row.id}`,
      userId: row.userId,
      createdAt: summary.createdAt,
      updatedAt: new Date(nowSeconds * 1_000),
    },
    user: {
      id: row.userId,
      name: row.userName,
      email: row.userEmail,
      emailVerified: Boolean(row.userEmailVerified),
      image: row.userImage,
      createdAt: new Date(row.userCreatedAt * 1_000),
      updatedAt: new Date(row.userUpdatedAt * 1_000),
    },
  };
}

export function personalAccessTokenCanWrite(
  token: Pick<PersonalAccessTokenSummary, "scopes">
): boolean {
  return token.scopes.includes("admin:write");
}

export function enforcePersonalAccessTokenMutationScope(
  request: Request,
  pathname: string,
  token: Pick<PersonalAccessTokenSummary, "scopes">
): Response | null {
  if (!requiresAdminMutationOrigin(request.method, pathname)) return null;
  if (personalAccessTokenCanWrite(token)) return null;

  return new Response(PERSONAL_ACCESS_TOKEN_WRITE_ERROR, {
    status: 403,
    headers: {
      "Cache-Control": "no-store",
      "Content-Type": "text/plain; charset=utf-8",
    },
  });
}
