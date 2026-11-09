import type { AstroCookies } from "astro";
import type { Auth } from "./auth";

export interface BrowserSession {
  session: AuthSession | null;
  user: AuthUser | null;
  /** What better-auth set while reading: a fresh `session_data` cache, a refreshed token, or expiries. */
  cookies: string[];
}

/**
 * The browser's session, as better-auth reads it, with the cookies it set while reading.
 *
 * better-auth answers most reads from its signed five-minute `session_data` cookie (auth.ts
 * `cookieCache`) with no D1 query. When that cookie is missing or stale it reads the session and user
 * from D1 and sets a fresh one; when the session nears its end it extends it and sets a new token.
 * Called as `auth.api.getSession()`, those cookies stay on better-auth's own response and are lost,
 * so after the first five minutes every navigation read D1 twice. `returnHeaders` keeps them for the
 * page's response (`withSessionCookies`).
 */
export async function readBrowserSession(auth: Pick<Auth, "api">, headers: Headers, disableCookieCache: boolean): Promise<BrowserSession> {
  const { headers: set, response } = await auth.api.getSession({ headers, query: { disableCookieCache }, returnHeaders: true });
  return { session: response?.session ?? null, user: response?.user ?? null, cookies: set.getSetCookie() };
}

/**
 * The response with the session cookies better-auth set while reading. Two exceptions:
 * - a cookie the response sets itself wins: signing out clears the very cookies this read may have
 *   refreshed, and appending ours after would keep the person signed in through the cache;
 * - nothing goes on a response a shared cache may keep (`Cache-Control: public`): one visitor's
 *   session must never reach another from a cache.
 */
export function withSessionCookies(response: Response, cookies: readonly string[]): Response {
  if (cookies.length === 0 || /(?:^|[\s,])public(?:$|[\s,])/i.test(response.headers.get("Cache-Control") ?? "")) return response;
  const own = new Set(response.headers.getSetCookie().map(cookieName));
  const added = cookies.filter((cookie) => !own.has(cookieName(cookie)));
  if (added.length === 0) return response;
  try {
    for (const cookie of added) response.headers.append("Set-Cookie", cookie);
    return response;
  } catch {
    // Immutable headers (Response.redirect, a fetched response) refuse the first append: answer with a copy.
    const copy = new Response(response.body, response);
    for (const cookie of added) copy.headers.append("Set-Cookie", cookie);
    return copy;
  }
}

const cookieName = (cookie: string) => cookie.slice(0, cookie.indexOf("=")).trim();

/** better-auth's five-minute cache of the session and user, and its chunks: `session_data.0`, … */
const SESSION_CACHE = /^(?:__Secure-)?better-auth\.session_data(?:\.\d+)?$/;

/**
 * After a write to the signed-in person's own user row (their name, their photo), expires the
 * `session_data` cache the request carried, so the next request reads the user from D1 instead of
 * showing the old name for up to five minutes. A cookie the response sets itself wins over the one
 * the middleware's read refreshed (`withSessionCookies`), so the expiry reaches the browser.
 */
export function expireSessionCache(request: Request, cookies: Pick<AstroCookies, "delete">): void {
  for (const pair of (request.headers.get("cookie") ?? "").split(";")) {
    const name = pair.slice(0, pair.includes("=") ? pair.indexOf("=") : undefined).trim();
    if (SESSION_CACHE.test(name)) cookies.delete(name, { path: "/", secure: name.startsWith("__Secure-") });
  }
}
