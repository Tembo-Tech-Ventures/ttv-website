import { describe, expect, it } from "vitest";
import { betterAuth } from "better-auth";
import { memoryAdapter } from "better-auth/adapters/memory";
import { createStagingBrowserCookies } from "./staging-fixture-cookies.mjs";
const baseUrl = "https://staging.tembotechventures.com";
const secret = "fictional-staging-fixture-signing-secret-123456";
const token = "a".repeat(64);
describe("synthetic staging browser cookie", () => {
  it("resolves with pinned BetterAuth and rejects wrong signature, expiry and revocation", async () => {
    const now = new Date(), expiresAt = Math.floor(Date.now() / 1000) + 3600;
    const data = {
      user: [{ id: "synthetic", name: "Fictional Member", email: "fictional@example.test", emailVerified: true, createdAt: now, updatedAt: now }],
      session: [{ id: "fixture-session", token, userId: "synthetic", expiresAt: new Date(expiresAt * 1000), createdAt: now, updatedAt: now, userAgent: "ttv-agent:synthetic-staging:fictional" }], account: [], verification: [],
    };
    const auth = betterAuth({ database: memoryAdapter(data), baseURL: baseUrl, secret, session: { cookieCache: { enabled: true, maxAge: 300 } } });
    const cookies = createStagingBrowserCookies({ baseUrl, secret, token, expiresAt });
    const headers = new globalThis.Headers({ cookie: cookies.map(c => `${c.name}=${c.value}`).join("; ") });
    expect(cookies[0]).toMatchObject({ domain: "staging.tembotechventures.com", httpOnly: true, secure: true, sameSite: "Lax", expires: expiresAt });
    expect((await auth.api.getSession({ headers }))?.user.id).toBe("synthetic");
    const wrong = createStagingBrowserCookies({ baseUrl, secret: "wrong-fictional-signing-secret-1234567890", token, expiresAt });
    expect(await auth.api.getSession({ headers: new globalThis.Headers({ cookie: wrong.map(c => `${c.name}=${c.value}`).join("; ") }) })).toBeNull();
    data.session[0].expiresAt = new Date(Date.now() - 1000);
    expect(await auth.api.getSession({ headers })).toBeNull();
    data.session.length = 0;
    expect(await auth.api.getSession({ headers })).toBeNull();
  });
  it.each(["https://ttv-website-production.fixture.workers.dev", "https://ttv-website-staging.fixture.workers.dev", "https://tembotechventures.com", "https://example.com", "http://staging.tembotechventures.com", "https://user@staging.tembotechventures.com", "https://staging.tembotechventures.com/path", "https://staging.tembotechventures.com?redirect=production"])("rejects nonstaging %s", url => {
    expect(() => createStagingBrowserCookies({ baseUrl: url, secret, token, expiresAt: Math.floor(Date.now() / 1000) + 3600 })).toThrow("Invalid staging");
  });
  it.each([-1, 7200])("rejects lifetime %s", seconds => {
    expect(() => createStagingBrowserCookies({ baseUrl, secret, token, expiresAt: Math.floor(Date.now() / 1000) + seconds })).toThrow("Invalid staging");
  });
});
