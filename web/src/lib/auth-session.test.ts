import { betterAuth } from "better-auth";
import { memoryAdapter } from "better-auth/adapters/memory";
import { afterEach, describe, expect, it, vi } from "vitest";
import { readBrowserSession, withSessionCookies } from "./auth-session";

/*
 * better-auth's five-minute `session_data` cookie spares two D1 reads on most navigations, but only
 * while the browser has a fresh one. These run against a real better-auth on an in-memory database.
 */
function makeAuth() {
  return betterAuth({
    database: memoryAdapter({ user: [], session: [], account: [], verification: [] }),
    secret: "fictional-test-secret-at-least-thirty-two-characters",
    baseURL: "https://ttv.invalid",
    emailAndPassword: { enabled: true },
    session: { cookieCache: { enabled: true, maxAge: 300 } },
  });
}

const pairs = (cookies: readonly string[]) => cookies.map((cookie) => cookie.split(";", 1)[0]!);
const named = (cookies: readonly string[], name: string) => cookies.filter((cookie) => new RegExp(`^(__Secure-)?better-auth\\.${name}=[^;]`).test(cookie));

async function signedIn(auth: ReturnType<typeof makeAuth>) {
  const signup = await auth.api.signUpEmail({
    body: { email: "akinyi@example.test", password: "fictional-password-12345", name: "Akinyi Otieno" },
    asResponse: true,
  });
  return pairs(signup.headers.getSetCookie());
}

afterEach(() => vi.useRealTimers());

describe("readBrowserSession", () => {
  it("hands back the fresh session_data better-auth sets once its cache has expired", async () => {
    vi.useFakeTimers({ toFake: ["Date"], now: Date.UTC(2026, 10, 8, 9) });
    const auth = makeAuth();
    const cookies = await signedIn(auth);
    // Six minutes later, the cached copy is stale: better-auth reads D1 and sets a new one.
    vi.setSystemTime(Date.UTC(2026, 10, 8, 9, 6));
    const read = await readBrowserSession(auth, new Headers({ cookie: cookies.join("; ") }), false);
    expect(read.user?.email).toBe("akinyi@example.test");
    expect(named(read.cookies, "session_data")).toHaveLength(1);

    // Plain getSession (what the middleware called before) leaves that cookie on better-auth's side.
    const plain = await auth.api.getSession({ headers: new Headers({ cookie: cookies.join("; ") }) });
    expect(plain?.user.email).toBe("akinyi@example.test");
    expect("headers" in (plain ?? {})).toBe(false);
  });

  it("sets nothing while the cached session is fresh, so a navigation costs no D1 read", async () => {
    const auth = makeAuth();
    const cookies = await signedIn(auth);
    const read = await readBrowserSession(auth, new Headers({ cookie: cookies.join("; ") }), false);
    expect(read.user?.email).toBe("akinyi@example.test");
    expect(read.cookies).toEqual([]);
  });

  it("finds no one, and sets nothing, without a session cookie", async () => {
    const read = await readBrowserSession(makeAuth(), new Headers(), false);
    expect(read).toEqual({ session: null, user: null, cookies: [] });
  });
});

describe("withSessionCookies", () => {
  const COOKIES = ["better-auth.session_data=abc; Max-Age=300; Path=/; HttpOnly", "b=; Expires=Thu, 01 Jan 1970 00:00:00 GMT; Path=/"];

  it("adds each cookie on its own, after the page's own", () => {
    const page = new Response("ok", { headers: { "Set-Cookie": "ttv-last-space=cohort; Path=/", "Cache-Control": "no-store" } });
    const response = withSessionCookies(page, COOKIES);
    expect(response).toBe(page);
    expect(response.headers.getSetCookie()).toEqual(["ttv-last-space=cohort; Path=/", ...COOKIES]);
  });

  it.each(["public, max-age=600", "max-age=3600, public", "PUBLIC"])("never puts a session on a response a shared cache may keep (%s)", (cacheControl) => {
    const response = withSessionCookies(new Response("feed", { headers: { "Cache-Control": cacheControl } }), COOKIES);
    expect(response.headers.getSetCookie()).toEqual([]);
  });

  it("copies a response whose headers are immutable", () => {
    const redirect = Response.redirect("https://ttv.invalid/auth/login", 302);
    const response = withSessionCookies(redirect, COOKIES);
    expect(response.status).toBe(302);
    expect(response.headers.get("Location")).toBe("https://ttv.invalid/auth/login");
    expect(response.headers.getSetCookie()).toEqual(COOKIES);
  });

  it("lets the response's own cookie win, so signing out is never undone by the read before it", () => {
    const signedOut = new Response(null, { status: 303, headers: { Location: "/" } });
    signedOut.headers.append("Set-Cookie", "better-auth.session_token=; Max-Age=0; Path=/");
    signedOut.headers.append("Set-Cookie", "better-auth.session_data=; Max-Age=0; Path=/");
    const response = withSessionCookies(signedOut, ["better-auth.session_data=fresh; Max-Age=300; Path=/", "better-auth.other=1; Path=/"]);
    expect(response.headers.getSetCookie()).toEqual([
      "better-auth.session_token=; Max-Age=0; Path=/", "better-auth.session_data=; Max-Age=0; Path=/", "better-auth.other=1; Path=/",
    ]);
  });

  it("leaves a response alone when better-auth set nothing", () => {
    const page = new Response("ok");
    expect(withSessionCookies(page, [])).toBe(page);
    expect(page.headers.getSetCookie()).toEqual([]);
  });
});
