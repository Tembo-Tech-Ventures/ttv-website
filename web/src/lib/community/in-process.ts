import { communityResponse } from "./route";

const LENT_HEADERS = ["cookie", "authorization", "origin", "user-agent"] as const;

/**
 * A `fetch` for `/api/community/*` that answers in process, as the browser's
 * own call would be answered. A page that renders on the server passes it to
 * the community client (community-client.ts), so the client's validation and
 * the API's sign-in, origin, token-scope and access checks are exactly those
 * of the island it replaces. The page's request lends its cookies,
 * authorization and origin; nothing else of it travels.
 */
export function communityFetch(page: Request, locals: App.Locals, env: Env): typeof fetch {
  return async (input, init) => {
    const url = new URL(input instanceof Request ? input.url : String(input), page.url);
    const prefix = "/api/community/";
    if (url.origin !== new URL(page.url).origin || !url.pathname.startsWith(prefix)) {
      throw new TypeError("communityFetch only answers this site's community API.");
    }
    const headers = new Headers();
    for (const name of LENT_HEADERS) {
      const value = page.headers.get(name);
      if (value !== null) headers.set(name, value);
    }
    const method = init?.method ?? "GET";
    if (init?.body !== undefined && init.body !== null) headers.set("content-type", "application/json");
    const request = new Request(url, { method, headers, body: method === "GET" || method === "HEAD" ? undefined : init?.body });
    return communityResponse(request, url.pathname.slice(prefix.length), locals, env);
  };
}
