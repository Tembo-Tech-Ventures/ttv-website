import { afterEach, describe, expect, it, vi } from "vitest";
import { betterAuth } from "better-auth";
import { memoryAdapter } from "better-auth/adapters/memory";
import { bearer } from "better-auth/plugins";
import { syntheticSessionHooks, syntheticSessionResponseHook } from "./synthetic-session-lifetime";

afterEach(() => { vi.useRealTimers(); });

function fixture(identity: { id: string; userId: string; userAgent: string }, hours = 8, environment = "agent-test", enabled = true) {
  vi.useFakeTimers({ toFake: ["Date"] });
  const now = new Date("2026-10-24T12:00:00Z");
  vi.setSystemTime(now);
  const data = {
    user: [{ id: identity.userId, name: "Fictional Amina", email: "fictional@invalid.ttv", emailVerified: true, createdAt: now, updatedAt: now }],
    session: [{ ...identity, token: "fictional-session-token", createdAt: now, updatedAt: now, expiresAt: new Date(+now + hours * 3600_000) }],
    account: [], verification: [],
  };
  const auth = betterAuth({
    database: memoryAdapter(data), baseURL: "http://localhost:4321",
    secret: "fictional-test-secret-at-least-thirty-two-characters",
    plugins: [bearer()], session: { cookieCache: { enabled: true, maxAge: 300 } },
    databaseHooks: syntheticSessionHooks(environment, enabled),
    hooks: syntheticSessionResponseHook(environment, enabled),
  });
  return { auth, data, now, headers: new Headers({ authorization: "Bearer fictional-session-token" }) };
}

const admin = { id: "ttv-agent-preview-session", userId: "ttv-agent-preview-user", userAgent: "ttv-agent:isolated-preview" };

describe("synthetic session absolute lifetime", () => {
  it.each([
    admin,
    { id: "ttv-fixture-session-journey-new", userId: "ttv-fixture-user-journey-new", userAgent: "ttv-agent:isolated-preview:persona" },
    { id: "ttv-feedback-run-test-session", userId: "ttv-feedback-run-test", userAgent: "ttv-agent:isolated-feedback" },
    { id: "fixture-session", userId: "ttv-staging-fixture-run-member", userAgent: "ttv-agent:synthetic-staging:run" },
  ])("never extends the seeded deadline for $userAgent", async identity => {
    const { auth, data, now, headers } = fixture(identity, identity === admin ? 8 : 1, "staging");
    const deadline = +data.session[0].expiresAt;
    for (const elapsed of [0, 10, 30]) {
      vi.setSystemTime(+now + elapsed * 60_000);
      const response = await auth.api.getSession({ headers, asResponse: true });
      expect(response.ok).toBe(true);
      const body = await response.json() as { session: { expiresAt: string } };
      expect(+new Date(body.session.expiresAt)).toBe(deadline);
      expect(+data.session[0].expiresAt).toBe(deadline);
    }
    vi.setSystemTime(deadline + 1);
    expect(await auth.api.getSession({ headers })).toBeNull();
  });

  it("clamps cookie refresh and rejects an expired cached synthetic session", async () => {
    const { auth, data, now, headers } = fixture(admin);
    const response = await auth.api.getSession({ headers, asResponse: true });
    const cookies = response.headers.getSetCookie().map(cookie => cookie.split(";", 1)[0]).join("; ");
    expect(cookies).toContain("session_token=");
    const cookieHeaders = new Headers({ cookie: cookies });
    vi.setSystemTime(+now + 7 * 3600_000);
    expect(await auth.api.getSession({ headers: cookieHeaders })).not.toBeNull();
    expect(+data.session[0].expiresAt).toBe(+now + 8 * 3600_000);
    vi.setSystemTime(+now + 8 * 3600_000 + 1);
    expect(await auth.api.getSession({ headers: cookieHeaders })).toBeNull();
  });

  it.each(["production", "prod", "unknown", undefined])("does not install hooks in %s", environment => {
    expect(syntheticSessionHooks(environment, true)).toBeUndefined();
    expect(syntheticSessionResponseHook(environment, true)).toBeUndefined();
  });
  it("does not install hooks when agent auth is off", () => {
    expect(syntheticSessionHooks("staging", false)).toBeUndefined();
    expect(syntheticSessionResponseHook("staging", false)).toBeUndefined();
  });
  it("rejects a legacy seven-day session beyond the absolute eight-hour limit without a refresh", async () => {
    const { auth, data, now, headers } = fixture(admin, 7 * 24);
    expect(await auth.api.getSession({ headers })).toMatchObject({ session: { expiresAt: new Date(+now + 8 * 3600_000) } });
    expect(+data.session[0].expiresAt).toBe(+now + 7 * 24 * 3600_000);
    vi.setSystemTime(+now + 9 * 3600_000);
    expect(await auth.api.getSession({ headers })).toBeNull();
  });
  it("rejects a still-fresh legacy cookie cache after the absolute deadline", async () => {
    const { auth, now, headers } = fixture(admin, 7 * 24);
    vi.setSystemTime(+now + (8 * 60 - 1) * 60_000);
    const response = await auth.api.getSession({ headers, asResponse: true });
    const cookie = response.headers.getSetCookie().map(value => value.split(";", 1)[0]).join("; ");
    expect(cookie).toContain("session_data=");
    vi.setSystemTime(+now + (8 * 60 + 1) * 60_000);
    expect(await auth.api.getSession({ headers: new Headers({ cookie }) })).toBeNull();
  });
  it("does not resurrect the prior session when a refresh loses a revocation race", async () => {
    const { auth, headers } = fixture(admin);
    auth.options.databaseHooks!.session!.update!.before = async () => false;
    const response = await auth.api.getSession({ headers, asResponse: true });
    expect(response.status).toBe(401);
    expect(await response.json()).not.toHaveProperty("session");
  });
  it.each([
    { ...admin, id: "ordinary-session", userId: "ordinary-user", userAgent: "browser" },
    { ...admin, id: "ordinary-session", userId: "ordinary-user" },
    { ...admin, userAgent: "browser" },
  ])("preserves normal refresh for non-fixture identity $id/$userAgent", async identity => {
    const { auth, data, now, headers } = fixture(identity);
    expect(await auth.api.getSession({ headers })).not.toBeNull();
    expect(+data.session[0].expiresAt).toBe(+now + 7 * 24 * 3600_000);
  });
});
