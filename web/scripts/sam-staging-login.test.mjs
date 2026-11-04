import { mkdtemp, readFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_ORIGIN, parseArguments, resolveToken, run } from "./sam-staging-login.mjs";

const TOKEN = "header.payload.signature";
const COOKIE = { name: "__Secure-better-auth.session_token", value: "session-secret", domain: "staging.tembotechventures.com", path: "/", expires: 2, httpOnly: true, secure: true, sameSite: "Lax" };
let outDir;

beforeEach(async () => {
  outDir = await mkdtemp(path.join(tmpdir(), "sam-login-test-"));
});
afterEach(async () => {
  await rm(outDir, { recursive: true, force: true });
});

describe("parseArguments", () => {
  it("reads a persona, a session length and an output directory", () => {
    expect(parseArguments(["mentor", "--ttl=30", "--out=/tmp/x"])).toEqual({ persona: "mentor", revoke: false, all: false, ttlMinutes: 30, outDir: "/tmp/x" });
  });

  it.each([
    [[], /one persona/],
    [["mentor", "admin"], /Unknown argument/],
    [["mentor", "--revoke"], /one persona/],
    [["../etc"], /Not a persona/],
    [["mentor", "--ttl=soon"], /whole number/],
    [["--force"], /Unknown argument/],
    [["mentor", "--all"], /goes with --revoke/],
  ])("refuses %j", (argv, message) => {
    expect(() => parseArguments(argv)).toThrow(message);
  });
});

describe("resolveToken", () => {
  it("explains how to get a token when SAM has not provided one", () => {
    expect(() => resolveToken({})).toThrow(/exec_with_secrets/);
    expect(() => resolveToken({ SAM_OIDC_TOKEN: "__SAM_SECRET_PLACEHOLDER__" })).toThrow(/exec_with_secrets/);
    expect(resolveToken({ SAM_OIDC_TOKEN: ` ${TOKEN} ` })).toBe(TOKEN);
  });
});

describe("run", () => {
  it("signs in and writes the cookie only to a private storage-state file", async () => {
    const fetchImpl = vi.fn(async () => Response.json({
      persona: "mentor", name: "David Kamau", summary: "An approved, listed mentor", userId: "ttv-sam-persona-mentor",
      loginId: "login-1", origin: DEFAULT_ORIGIN, expiresAt: "2026-11-04T20:00:00.000Z", cookies: [COOKIE],
    }));
    const result = await run({ persona: "mentor", revoke: false, ttlMinutes: 30, outDir }, { environment: { SAM_OIDC_TOKEN: TOKEN }, fetchImpl });

    const [url, init] = fetchImpl.mock.calls[0];
    expect(String(url)).toBe(`${DEFAULT_ORIGIN}/api/staging/sam-login`);
    expect(init).toMatchObject({ method: "POST", headers: { Authorization: `Bearer ${TOKEN}` }, body: JSON.stringify({ persona: "mentor", ttlMinutes: 30 }) });
    expect(JSON.stringify(result)).not.toContain("session-secret");
    expect(result).toMatchObject({ persona: "mentor", storageState: path.join(outDir, "mentor.json") });
    expect(JSON.parse(await readFile(result.storageState, "utf8"))).toEqual({ cookies: [COOKIE], origins: [] });
    expect((await stat(result.storageState)).mode & 0o777).toBe(0o600);
  });

  it("revokes with DELETE and the origin SAM_LOGIN_ORIGIN names", async () => {
    const fetchImpl = vi.fn(async () => Response.json({ revoked: 2, newcomersRemoved: 1, newcomersKept: 0 }));
    const result = await run({ persona: null, revoke: true, all: false, outDir }, { environment: { SAM_OIDC_TOKEN: TOKEN, SAM_LOGIN_ORIGIN: "http://127.0.0.1:4321" }, fetchImpl });
    expect(result).toEqual({ revoked: 2, newcomersRemoved: 1, newcomersKept: 0 });
    expect(String(fetchImpl.mock.calls[0][0])).toBe("http://127.0.0.1:4321/api/staging/sam-login");
    expect(fetchImpl.mock.calls[0][1]).toMatchObject({ method: "DELETE", body: "{}" });
  });

  it("asks for every task's logins with --all", async () => {
    const fetchImpl = vi.fn(async () => Response.json({ revoked: 0, newcomersRemoved: 0, newcomersKept: 0 }));
    await run({ persona: null, revoke: true, all: true, outDir }, { environment: { SAM_OIDC_TOKEN: TOKEN }, fetchImpl });
    expect(fetchImpl.mock.calls[0][1]).toMatchObject({ body: JSON.stringify({ all: true }) });
  });

  it("never sends the token anywhere but staging or a local build", async () => {
    const fetchImpl = vi.fn();
    for (const origin of ["https://tembotechventures.com", "https://evil.example", "http://staging.tembotechventures.com"]) {
      await expect(run({ persona: "admin", revoke: false, outDir }, { environment: { SAM_OIDC_TOKEN: TOKEN, SAM_LOGIN_ORIGIN: origin }, fetchImpl })).rejects.toThrow(/SAM_LOGIN_ORIGIN must be/);
    }
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("says when SAM login is not enabled", async () => {
    const fetchImpl = async () => Response.json({ error: "Not found." }, { status: 404 });
    await expect(run({ persona: "admin", revoke: false, outDir }, { environment: { SAM_OIDC_TOKEN: TOKEN }, fetchImpl })).rejects.toThrow(/not enabled/);
  });
});
