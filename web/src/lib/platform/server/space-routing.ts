import type { APIContext, MiddlewareNext } from "astro";
import type { Me } from "../contracts";
import { readLastSpaceCookie, selectDefaultSpace, serializeLastSpaceCookie } from "../client/spaces-selection";
import { demoPathAllowed } from "@/lib/staging-demo-policy";
import { qaPathAllowed } from "@/lib/staging-qa-policy";
import { stagingFixturePathAllowed } from "@/lib/staging-fixture-policy";
import { getSpaceContext } from "./space-context";
import {
  canonicalSpacePath, isAvailableSpacePath, isNewSpacePath, legacySpacePath,
  normalizeSpacePath, SPACE_PATHS, spaceForPath,
} from "./space-routes";

function privateResponse(response: Response): Response {
  response.headers.set("Cache-Control", "no-store");
  const vary = response.headers.get("Vary")?.split(",").map(value => value.trim()) ?? [];
  if (!vary.some(value => value.toLowerCase() === "cookie")) vary.push("Cookie");
  response.headers.set("Vary", vary.join(", "));
  return response;
}

function denial(status: number): Response {
  return privateResponse(new Response(status === 404 ? "Not found." : "Forbidden.", { status }));
}

function defaultSpaceResponse({ locals, request, url, redirect }: APIContext, me: Me): Response {
  // Restricted test identities retain their exact existing surface boundaries.
  const spaces = me.spaces.filter(space => {
    const target = SPACE_PATHS[space];
    return (!locals.stagingQa || qaPathAllowed(locals.stagingQa.persona, target, request.method))
      && (!locals.stagingDemo || demoPathAllowed(target, request.method))
      && (!locals.stagingFixture || stagingFixturePathAllowed(target));
  });
  const selected = selectDefaultSpace(spaces, { lastSpace: readLastSpaceCookie(request.headers.get("cookie")) });
  return selected ? privateResponse(redirect(SPACE_PATHS[selected] + url.search, 302)) : denial(403);
}

async function serveSpacePage(context: APIContext, next: MiddlewareNext, me: Me, canonical: string | null): Promise<Response> {
  const { request, url } = context;
  const path = normalizeSpacePath(url.pathname);
  const target = canonical ?? path;
  if (!isAvailableSpacePath(target)) return denial(404);
  const space = spaceForPath(target);
  // These existing signed-in pages do not grant cohort or recording access.
  const signedInEntry = target === "/dashboard/cohort/apply" || target === "/dashboard/cohort/ask";
  // Admin review is an existing page permission, not mentoring membership.
  const adminReview = space === "mentoring" && me.capabilities.isAdmin;
  if (!space || (!me.spaces.includes(space) && !signedInEntry && !adminReview)) return denial(403);

  const read = request.method === "GET" || request.method === "HEAD";
  if (canonical && read) return privateResponse(context.redirect(canonical + url.search, 301));

  const legacy = legacySpacePath(target);
  const rewritten = new URL(url);
  rewritten.pathname = legacy;
  // next(Request) uses Astro's single-pass rewrite and preserves form bodies.
  const response = legacy !== path && !canonical
    ? await next(new Request(rewritten, request))
    : await next();
  privateResponse(response);
  if (read && response.status >= 200 && response.status < 300 && me.spaces.includes(space)) {
    response.headers.append("Set-Cookie", serializeLastSpaceCookie(space, url.protocol === "https:"));
  }
  return response;
}

/** Boundary checks must precede this helper, including in the QA authentication branch. */
export async function routeSpaceRequest(context: APIContext, next: MiddlewareNext): Promise<Response> {
  const { request, url } = context;
  const path = normalizeSpacePath(url.pathname);
  const canonical = canonicalSpacePath(path);
  const newPath = isNewSpacePath(path);
  // Me is browser-only. Preserve existing PAT page verification after the
  // middleware's authentication, delegation and fixture allowlists have run.
  // Never redirect a PAT into a canonical route it cannot access.
  if (context.locals.personalAccessToken && !newPath) return next();
  if (path !== "/dashboard" && !canonical && !newPath && path !== SPACE_PATHS.community && path !== SPACE_PATHS.discover) {
    return next();
  }

  let me;
  try {
    me = await getSpaceContext(context);
  } catch (error) {
    // OFF keeps every previously shipped page/POST at its existing URL.
    if (error instanceof Response) {
      if (error.status === 404) return newPath ? denial(404) : next();
      return privateResponse(error);
    }
    // Optional space context must not make a shipped URL less available.
    // Earlier auth/delegation/fixture boundaries already ran; the unchanged
    // legacy page still enforces its own data access. Never rewrite on failure.
    if (!newPath) return next();
    // New canonical routes fail closed through the middleware error observer.
    throw error;
  }

  const read = request.method === "GET" || request.method === "HEAD";
  if (path === "/dashboard") {
    if (!read) return next();
    return defaultSpaceResponse(context, me);
  }
  return serveSpacePage(context, next, me, canonical);
}
