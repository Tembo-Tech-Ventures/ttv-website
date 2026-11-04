import { beforeAll, describe, expect, it, vi } from "vitest";
import { SAM_OIDC_JWKS_URL, samKeySource, SamTokenError, verifySamToken } from "./oidc";
import { createSigner, NOW, ORIGIN, PROJECT_ID, SAM_USER_ID, samClaims, type TestSigner } from "./test-tokens";

let signer: TestSigner;
beforeAll(async () => {
  signer = await createSigner();
});

const verify = (token: string, now = NOW, keys = signer.keys) => verifySamToken(token, { audience: ORIGIN, keys, now });

async function rejection(token: string | Promise<string>, now = NOW) {
  const error = await verify(await token, now).catch((caught: unknown) => caught);
  expect(error).toBeInstanceOf(SamTokenError);
  return (error as Error).message;
}

describe("verifySamToken", () => {
  it("accepts a SAM workload-identity token for this origin and returns its owner", async () => {
    const claims = await verify(await signer.sign(samClaims({ jti: "jti-1" })));
    expect(claims).toEqual({
      subject: `project:${PROJECT_ID}:user:${SAM_USER_ID}:profile:profile-1`,
      projectId: PROJECT_ID,
      userId: SAM_USER_ID,
      jti: "jti-1",
      issuedAt: NOW,
      expiresAt: NOW + 300,
      taskId: "task-1",
      workspaceId: "workspace-1",
      agentSessionId: "agent-session-1",
      chatSessionId: "chat-1",
    });
  });

  it("accepts a one-element audience array and a subject with nothing after the user", async () => {
    const claims = await verify(await signer.sign(samClaims({ aud: [ORIGIN], sub: `project:${PROJECT_ID}:user:${SAM_USER_ID}` })));
    expect(claims.userId).toBe(SAM_USER_ID);
  });

  it("rejects a token signed by any other key, even one with the same key id", async () => {
    const impostor = await createSigner(signer.kid);
    expect(await rejection(impostor.sign())).toMatch(/signature/);
  });

  it("rejects a payload changed after signing", async () => {
    const [header, , signature] = (await signer.sign()).split(".");
    const forged = Buffer.from(JSON.stringify(samClaims({ user_id: "someone-else", sub: `project:${PROJECT_ID}:user:someone-else` }))).toString("base64url");
    expect(await rejection(`${header}.${forged}.${signature}`)).toMatch(/signature/);
  });

  it.each([
    ["none", { alg: "none" }],
    ["HS256", { alg: "HS256" }],
    ["a crit header", { crit: ["exp"] }],
    ["another typ", { typ: "at+jwt" }],
  ])("rejects %s", async (_, header) => {
    expect(await rejection(signer.sign(samClaims(), header))).toMatch(/algorithm|critical|type/);
  });

  it("rejects an unsigned token outright", async () => {
    const [header, payload] = (await signer.sign()).split(".");
    expect(await rejection(`${header}.${payload}.`)).toMatch(/malformed/);
  });

  it.each([
    ["another issuer", { iss: "https://api.simple-agent-manager.org" }, /issuer/],
    ["another audience", { aud: "https://tembotechventures.com" }, /audience/],
    ["two audiences", { aud: [ORIGIN, "https://tembotechventures.com"] }, /audience/],
    ["no audience", { aud: undefined }, /audience/],
    ["another token type", { type: "workspace" }, /token type/],
    ["an expired token", { iat: NOW - 400, exp: NOW - 1 }, /expired/],
    ["a token issued in the future", { iat: NOW + 120, exp: NOW + 400 }, /future/],
    ["a long-lived token", { exp: NOW + 3600 }, /lifetime/],
    ["a token not valid yet", { nbf: NOW + 120 }, /not yet valid/],
    ["no jti", { jti: undefined }, /jti/],
    ["no project", { project_id: undefined }, /project_id/],
    ["a subject for another user", { sub: `project:${PROJECT_ID}:user:someone-else:profile:p` }, /subject/],
    ["a subject that only shares a prefix", { sub: `project:${PROJECT_ID}:user:${SAM_USER_ID}x:profile:p` }, /subject/],
  ])("rejects %s", async (_, overrides, reason) => {
    expect(await rejection(signer.sign(samClaims(overrides)))).toMatch(reason);
  });

  it("rejects a key under 2048 bits", async () => {
    const weak = await createSigner("weak", 1024);
    const error = await verifySamToken(await weak.sign(), { audience: ORIGIN, keys: weak.keys, now: NOW }).catch((caught: unknown) => caught);
    expect(String(error)).toMatch(/weak key/);
  });

  it("rejects an unknown key id after one refresh", async () => {
    const keys = { keys: vi.fn(async () => [signer.publicJwk]) };
    const other = await createSigner("rotated");
    expect(String(await verify(await other.sign(), NOW, keys).catch(String))).toMatch(/unknown key/);
    expect(keys.keys.mock.calls).toEqual([[false], [true]]);
  });
});

describe("samKeySource", () => {
  const response = (keys: unknown[]) => new Response(JSON.stringify({ keys }));

  it("fetches SAM's fixed key set and caches it", async () => {
    const fetchImpl = vi.fn(async () => response([signer.publicJwk]));
    const source = samKeySource(fetchImpl as unknown as typeof fetch, () => 0);
    expect(await source.keys(false)).toEqual([signer.publicJwk]);
    await source.keys(false);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(fetchImpl).toHaveBeenCalledWith(SAM_OIDC_JWKS_URL, expect.anything());
  });

  it("refreshes for an unknown key at most once a minute, and when the cache is stale", async () => {
    let now = 0;
    const fetchImpl = vi.fn(async () => response([signer.publicJwk]));
    const source = samKeySource(fetchImpl as unknown as typeof fetch, () => now);
    await source.keys(false);
    await source.keys(true);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    now = 61_000;
    await source.keys(true);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    now += 11 * 60_000;
    await source.keys(false);
    expect(fetchImpl).toHaveBeenCalledTimes(3);
  });

  it("fails closed when the key set can't be read", async () => {
    const source = samKeySource((async () => new Response("down", { status: 503 })) as unknown as typeof fetch, () => 0);
    await expect(source.keys(false)).rejects.toThrow(SamTokenError);
  });
});
