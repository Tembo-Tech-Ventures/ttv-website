import { experimental_AstroContainer as AstroContainer } from "astro/container";
import { loadRenderers } from "astro:container";
import { getContainerRenderer } from "@astrojs/react/container-renderer";
import { betterAuth } from "better-auth";
import { memoryAdapter } from "better-auth/adapters/memory";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

/*
 * /auth/logout: a GET only asks "Sign out?", and only a POST signs out. Link prefetchers, chat-app
 * link previews and browser preloading all fetch with GET, and used to end people's sessions. The
 * page runs against a real better-auth on an in-memory database, so "still signed in" means the
 * session row survives, not that a mock went uncalled.
 */
const mocks = vi.hoisted(() => ({ auth: null as unknown, failSignOut: false }));
vi.mock("cloudflare:workers", () => ({ env: {} }));
vi.mock("@/lib/auth", () => ({
  createAuth: () => {
    const auth = mocks.auth as ReturnType<typeof makeAuth>;
    if (!mocks.failSignOut) return auth;
    return { api: { ...auth.api, signOut: async () => new Response("upstream detail", { status: 500 }) } };
  },
}));

const { default: Page } = await import("../logout.astro");

const ORIGIN = "https://ttv.invalid";

function makeAuth() {
  return betterAuth({
    database: memoryAdapter({ user: [], session: [], account: [], verification: [] }),
    secret: "fictional-test-secret-at-least-thirty-two-characters",
    baseURL: ORIGIN,
    emailAndPassword: { enabled: true },
    session: { cookieCache: { enabled: true, maxAge: 300 } },
  });
}

let container: AstroContainer;
beforeAll(async () => {
  container = await AstroContainer.create({ renderers: await loadRenderers([getContainerRenderer()]) });
});

let auth: ReturnType<typeof makeAuth>;
let cookie: string;
beforeEach(async () => {
  auth = makeAuth();
  mocks.auth = auth;
  mocks.failSignOut = false;
  const signup = await auth.api.signUpEmail({
    body: { email: "wanjiru@example.test", password: "fictional-password-12345", name: "Wanjiru Njeri" },
    asResponse: true,
  });
  cookie = signup.headers.getSetCookie().map((set) => set.split(";", 1)[0]).join("; ");
});

/** The session as the database has it, past the signed cookie cache. */
const session = () => auth.api.getSession({ headers: new Headers({ cookie }), query: { disableCookieCache: true } });

async function visit(method: "GET" | "POST", signedIn = true) {
  const url = new URL("/auth/logout", ORIGIN);
  const request = method === "GET"
    ? new Request(url, { headers: { cookie } })
    : new Request(url, { method: "POST", headers: { cookie, Origin: ORIGIN, "Content-Type": "application/x-www-form-urlencoded" }, body: "" });
  const user = signedIn ? (await session())?.user ?? null : null;
  const response = await container.renderToResponse(Page, { request, locals: { user } as App.Locals });
  return { status: response.status, headers: response.headers, body: await response.text() };
}

describe("/auth/logout", () => {
  it("asks on a GET, with a form that posts, and leaves the session alone", async () => {
    expect(await session()).not.toBeNull();
    const { status, headers, body } = await visit("GET");
    expect(status).toBe(200);
    expect(headers.get("Cache-Control")).toBe("no-store");
    expect(headers.getSetCookie()).toEqual([]);
    expect(body.match(/<h1\b/g)).toHaveLength(1);
    expect(body).toMatch(/<h1[^>]*data-page-title[^>]*>Sign out\?<\/h1>/);
    expect(body).toMatch(/<form method="POST"[^>]*data-sign-out-form/);
    expect(body).not.toMatch(/<form[^>]*action=/);
    expect(body).toMatch(/<button[^>]*type="submit"[^>]*>[\s\S]*?Sign out[\s\S]*?<\/button>/);
    expect(body).toMatch(/<a[^>]*href="\/dashboard"[^>]*>[\s\S]*?Stay signed in/);
    // The one peach action is Sign out; staying is quiet.
    expect(body.match(/bg-primary text-dark/g)).toHaveLength(1);
    expect(await session()).not.toBeNull();
  });

  it("signs out on a POST with a 303 home, clearing the session and its cookie cache", async () => {
    const { status, headers } = await visit("POST");
    expect(status).toBe(303);
    expect(headers.get("Location")).toBe("/");
    expect(headers.get("Cache-Control")).toBe("no-store");
    const cleared = headers.getSetCookie();
    expect(cleared.some((set) => /^(__Secure-)?better-auth\.session_token=;/.test(set) && /max-age=0/i.test(set))).toBe(true);
    expect(cleared.some((set) => /^(__Secure-)?better-auth\.session_data=;/.test(set) && /max-age=0/i.test(set))).toBe(true);
    expect(await session()).toBeNull();
  });

  it("asks again with a danger notice when better-auth cannot sign out, and claims nothing", async () => {
    mocks.failSignOut = true;
    const { status, headers, body } = await visit("POST");
    expect(status).toBe(503);
    expect(headers.get("Location")).toBeNull();
    expect(headers.getSetCookie()).toEqual([]);
    expect(body).toContain("<title>Error: Sign out");
    expect(body).toMatch(/role="alert"[\s\S]*?We couldn(?:'|&#x27;|&#39;)t sign you out/);
    expect(body).not.toContain("upstream detail");
    expect(body).toMatch(/<form method="POST"[^>]*data-sign-out-form/);
    expect(await session()).not.toBeNull();
  });

  it("sends a signed-out visitor home, whichever the method", async () => {
    const get = await visit("GET", false);
    expect(get.status).toBe(302);
    expect(get.headers.get("Location")).toBe("/");
    const post = await visit("POST", false);
    expect(post.status).toBe(303);
    expect(post.headers.get("Location")).toBe("/");
    expect(await session()).not.toBeNull();
  });
});
