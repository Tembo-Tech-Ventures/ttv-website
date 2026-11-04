/**
 * Verifies SAM's workload-identity tokens: the short-lived JWT that SAM's `exec_with_secrets`
 * injects as SAM_OIDC_TOKEN when a command asks for an OIDC audience. The issuer and its key set
 * are fixed here, never taken from the token or the request.
 */
export const SAM_OIDC_ISSUER = "https://api.simple-agent-manager.org/oidc";
export const SAM_OIDC_JWKS_URL = `${SAM_OIDC_ISSUER}/.well-known/jwks.json`;

/** SAM issues five-minute tokens; anything meant to live longer than this is refused. */
const MAX_LIFETIME_SECONDS = 600;
const CLOCK_SKEW_SECONDS = 60;
const MAX_TOKEN_LENGTH = 8192;
const MIN_MODULUS_BITS = 2048;
const JWKS_TTL_MS = 10 * 60_000;
/** An unknown key id refreshes the key set at most this often, so junk tokens can't hammer SAM. */
const JWKS_REFRESH_INTERVAL_MS = 60_000;
/** A hung key-set request fails closed instead of holding the login open. */
const JWKS_TIMEOUT_MS = 5_000;

export class SamTokenError extends Error {
  constructor(reason: string) {
    super(`SAM token rejected: ${reason}`);
  }
}

export interface SamClaims {
  subject: string;
  projectId: string;
  userId: string;
  jti: string;
  issuedAt: number;
  expiresAt: number;
  taskId: string | null;
  workspaceId: string | null;
  agentSessionId: string | null;
  chatSessionId: string | null;
}

type Jwk = JsonWebKey & { kid?: string };

export interface KeySource {
  /** The issuer's signing keys; `refresh` asks for a fresh copy when a key id is unknown. */
  keys(refresh: boolean): Promise<Jwk[]>;
}

/** SAM's published key set, cached per isolate. */
export function samKeySource(fetchImpl: typeof fetch = fetch, clock: () => number = Date.now): KeySource {
  let cached: { keys: Jwk[]; fetchedAt: number } | null = null;
  return {
    async keys(refresh) {
      const now = clock();
      const stale = !cached || now - cached.fetchedAt > JWKS_TTL_MS;
      const mayRefresh = refresh && (!cached || now - cached.fetchedAt > JWKS_REFRESH_INTERVAL_MS);
      if (stale || mayRefresh) {
        const response = await fetchImpl(SAM_OIDC_JWKS_URL, { headers: { Accept: "application/json" }, signal: AbortSignal.timeout(JWKS_TIMEOUT_MS) })
          .catch(() => { throw new SamTokenError("key set unavailable"); });
        if (!response.ok) throw new SamTokenError("key set unavailable");
        const body = (await response.json().catch(() => ({}))) as { keys?: unknown };
        if (!Array.isArray(body.keys)) throw new SamTokenError("key set unavailable");
        cached = { keys: body.keys as Jwk[], fetchedAt: now };
      }
      return cached!.keys;
    },
  };
}

const SEGMENT = /^[A-Za-z0-9_-]+$/;

function decodeSegment(segment: string): Uint8Array<ArrayBuffer> {
  if (!SEGMENT.test(segment)) throw new SamTokenError("malformed");
  return new Uint8Array(Buffer.from(segment, "base64url"));
}

function decodeJson(segment: string): Record<string, unknown> {
  try {
    const value: unknown = JSON.parse(new TextDecoder().decode(decodeSegment(segment)));
    if (value && typeof value === "object" && !Array.isArray(value)) return value as Record<string, unknown>;
  } catch (error) {
    if (error instanceof SamTokenError) throw error;
  }
  throw new SamTokenError("malformed");
}

const optionalString = (value: unknown) => (typeof value === "string" && value.length > 0 && value.length <= 128 ? value : null);

function requiredString(value: unknown, claim: string): string {
  const text = optionalString(value);
  if (!text) throw new SamTokenError(`missing ${claim}`);
  return text;
}

function requiredTime(value: unknown, claim: string): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0) throw new SamTokenError(`missing ${claim}`);
  return value;
}

async function signingKey(source: KeySource, kid: string): Promise<CryptoKey> {
  let jwk = (await source.keys(false)).find((key) => key.kid === kid);
  if (!jwk) jwk = (await source.keys(true)).find((key) => key.kid === kid);
  if (!jwk) throw new SamTokenError("unknown key");
  if (jwk.kty !== "RSA" || (jwk.alg && jwk.alg !== "RS256") || (jwk.use && jwk.use !== "sig") || !jwk.n || !jwk.e) {
    throw new SamTokenError("unusable key");
  }
  if (decodeSegment(jwk.n).length * 8 < MIN_MODULUS_BITS) throw new SamTokenError("weak key");
  return crypto.subtle.importKey(
    "jwk",
    { kty: "RSA", n: jwk.n, e: jwk.e, alg: "RS256", ext: true },
    { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
    false,
    ["verify"],
  );
}

/** Only RS256 with a key id; the header never chooses where keys come from. */
function headerKeyId(header: Record<string, unknown>): string {
  if (header.alg !== "RS256") throw new SamTokenError("algorithm");
  if (header.typ !== undefined && header.typ !== "JWT") throw new SamTokenError("type");
  if (header.crit !== undefined) throw new SamTokenError("critical header");
  return requiredString(header.kid, "kid");
}

function checkTimes(claims: Record<string, unknown>, now: number) {
  const issuedAt = requiredTime(claims.iat, "iat");
  const expiresAt = requiredTime(claims.exp, "exp");
  if (issuedAt > now + CLOCK_SKEW_SECONDS) throw new SamTokenError("issued in the future");
  if (expiresAt <= now) throw new SamTokenError("expired");
  if (expiresAt <= issuedAt || expiresAt - issuedAt > MAX_LIFETIME_SECONDS) throw new SamTokenError("lifetime");
  if (claims.nbf !== undefined && requiredTime(claims.nbf, "nbf") > now + CLOCK_SKEW_SECONDS) throw new SamTokenError("not yet valid");
  return { issuedAt, expiresAt };
}

/** Checks signature, issuer, the exact audience, timing and SAM's workload-identity shape. */
export async function verifySamToken(
  token: string,
  { audience, keys, now = Math.floor(Date.now() / 1000) }: { audience: string; keys: KeySource; now?: number },
): Promise<SamClaims> {
  if (token.length > MAX_TOKEN_LENGTH) throw new SamTokenError("malformed");
  const parts = token.split(".");
  if (parts.length !== 3) throw new SamTokenError("malformed");
  const [encodedHeader, encodedPayload, encodedSignature] = parts;
  const key = await signingKey(keys, headerKeyId(decodeJson(encodedHeader)));
  const signed = new TextEncoder().encode(`${encodedHeader}.${encodedPayload}`);
  const valid = await crypto.subtle.verify("RSASSA-PKCS1-v1_5", key, decodeSegment(encodedSignature), signed);
  if (!valid) throw new SamTokenError("signature");

  const claims = decodeJson(encodedPayload);
  if (claims.iss !== SAM_OIDC_ISSUER) throw new SamTokenError("issuer");
  const audiences = Array.isArray(claims.aud) ? claims.aud : [claims.aud];
  if (audiences.length !== 1 || audiences[0] !== audience) throw new SamTokenError("audience");
  if (claims.type !== "workload-identity") throw new SamTokenError("token type");
  const { issuedAt, expiresAt } = checkTimes(claims, now);

  const projectId = requiredString(claims.project_id, "project_id");
  const userId = requiredString(claims.user_id, "user_id");
  const subject = typeof claims.sub === "string" && claims.sub.length <= 512 ? claims.sub : "";
  // SAM's subject names the same project and user as its claims; a mismatch is a malformed token.
  const owner = `project:${projectId}:user:${userId}`;
  if (subject !== owner && !subject.startsWith(`${owner}:`)) throw new SamTokenError("subject");

  return {
    subject,
    projectId,
    userId,
    jti: requiredString(claims.jti, "jti"),
    issuedAt,
    expiresAt,
    taskId: optionalString(claims.task_id),
    workspaceId: optionalString(claims.workspace_id),
    agentSessionId: optionalString(claims.agent_session_id),
    chatSessionId: optionalString(claims.chat_session_id),
  };
}
