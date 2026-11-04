import { SAM_OIDC_ISSUER, type KeySource } from "./oidc";

/** Test-only signer: an RSA key pair standing in for SAM's, and tokens shaped like SAM's workload identities. */
export const PROJECT_ID = "01KK26ZXDF2067T5592MBP4013";
export const SAM_USER_ID = "4bw1FJlXCOgSGq0TsQgpiMAhQKjGOSXx";
export const ORIGIN = "https://staging.tembotechventures.com";
export const NOW = 1_793_818_697;

export interface TestSigner {
  kid: string;
  publicJwk: JsonWebKey & { kid: string; alg: string; use: string };
  keys: KeySource;
  sign(claims?: Record<string, unknown>, header?: Record<string, unknown>): Promise<string>;
}

const encode = (value: unknown) => Buffer.from(typeof value === "string" ? value : JSON.stringify(value)).toString("base64url");

export function samClaims(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    project_id: PROJECT_ID,
    project_name: "TTV",
    user_id: SAM_USER_ID,
    chat_session_id: "chat-1",
    agent_session_id: "agent-session-1",
    workspace_id: "workspace-1",
    agent_profile_id: "profile-1",
    task_id: "task-1",
    triggered_by: "user",
    type: "workload-identity",
    iss: SAM_OIDC_ISSUER,
    sub: `project:${PROJECT_ID}:user:${SAM_USER_ID}:profile:profile-1`,
    aud: ORIGIN,
    iat: NOW,
    exp: NOW + 300,
    jti: crypto.randomUUID(),
    ...overrides,
  };
}

export async function createSigner(kid = "test-key", modulusLength = 2048): Promise<TestSigner> {
  const pair = await crypto.subtle.generateKey(
    { name: "RSASSA-PKCS1-v1_5", modulusLength, publicExponent: new Uint8Array([1, 0, 1]), hash: "SHA-256" },
    true,
    ["sign", "verify"],
  );
  const exported = await crypto.subtle.exportKey("jwk", pair.publicKey);
  const publicJwk = { kty: exported.kty, n: exported.n, e: exported.e, kid, alg: "RS256", use: "sig" };
  return {
    kid,
    publicJwk,
    keys: { keys: async () => [publicJwk] },
    async sign(claims = samClaims(), header = {}) {
      const signingInput = `${encode({ alg: "RS256", kid, typ: "JWT", ...header })}.${encode(claims)}`;
      const signature = await crypto.subtle.sign("RSASSA-PKCS1-v1_5", pair.privateKey, new TextEncoder().encode(signingInput));
      return `${signingInput}.${Buffer.from(signature).toString("base64url")}`;
    },
  };
}
