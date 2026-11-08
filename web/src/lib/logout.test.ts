import { describe, expect, it } from "vitest";
import { betterAuth } from "better-auth";
import { memoryAdapter } from "better-auth/adapters/memory";
import { logoutResponse } from "./logout";

function applyCookies(jar: Map<string, string>, response: Response) {
  for (const cookie of response.headers.getSetCookie()) {
    const pair = cookie.split(";", 1)[0];
    const separator = pair.indexOf("=");
    const name = pair.slice(0, separator);
    if (/max-age=0(?:;|$)/i.test(cookie)) jar.delete(name);
    else jar.set(name, pair.slice(separator + 1));
  }
}
function requestHeaders(jar: Map<string, string>) {
  return new Headers({ cookie: [...jar].map(([name, value]) => `${name}=${value}`).join("; ") });
}

describe("logout response", () => {
  it("clears the pinned Better Auth cached session in the browser as well as the database", async () => {
    const auth = betterAuth({
      database: memoryAdapter({ user: [], session: [], account: [], verification: [] }),
      secret: "fictional-test-secret-at-least-thirty-two-characters",
      baseURL: "http://localhost:4321",
      emailAndPassword: { enabled: true },
      session: { cookieCache: { enabled: true, maxAge: 300 } },
    });
    const signup = await auth.api.signUpEmail({ body: {
      email: "logout-fixture@example.test", password: "fictional-password-12345", name: "Logout Fixture",
    }, asResponse: true });
    expect(signup.ok).toBe(true);
    const jar = new Map<string, string>();
    applyCookies(jar, signup);
    const originalHeaders = requestHeaders(jar);
    expect(await auth.api.getSession({ headers: originalHeaders })).not.toBeNull();
    const response = await logoutResponse(originalHeaders, (options) => auth.api.signOut(options));
    if (!response) throw new Error("sign out failed");
    // 303, so the browser follows with a GET and never replays the POST that signed out.
    expect(response.status).toBe(303);
    expect(response.headers.get("location")).toBe("/");
    expect(response.headers.getSetCookie().length).toBeGreaterThanOrEqual(2);
    // Regression: unchanged browser cookies still authenticate from the cache after DB deletion.
    expect(await auth.api.getSession({ headers: originalHeaders })).not.toBeNull();
    expect(await auth.api.getSession({ headers: originalHeaders, query: { disableCookieCache: true } })).toBeNull();
    applyCookies(jar, response);
    expect(await auth.api.getSession({ headers: requestHeaders(jar) })).toBeNull();
  });

  it("preserves separate expiration headers including comma-containing dates", async () => {
    const cookies = ["a=; Expires=Thu, 01 Jan 1970 00:00:00 GMT; Path=/", "b=; Max-Age=0; HttpOnly; Path=/"];
    const headers = new Headers();
    for (const cookie of cookies) headers.append("Set-Cookie", cookie);
    const response = await logoutResponse(new Headers(), async () => new Response("{}", { headers }));
    if (!response) throw new Error("sign out failed");
    expect(response.headers.getSetCookie()).toEqual(cookies);
    expect(response.headers.get("cache-control")).toBe("no-store");
  });

  it.each(["throws", "non-success"])("does not claim success when sign out %s, so the page can say so", async (failure) => {
    const response = await logoutResponse(new Headers(), async () => {
      if (failure === "throws") throw new Error("sensitive upstream detail");
      return new Response("sensitive upstream detail", { status: 500, headers: { "Set-Cookie": "a=; Max-Age=0" } });
    });
    expect(response).toBeNull();
  });
});
