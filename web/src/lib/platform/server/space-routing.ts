import type { APIContext, MiddlewareNext } from "astro";
import { env } from "cloudflare:workers";
import { getOnboardingState, markAccessRequestSeen } from "@/lib/onboarding/service";
import { recordError } from "@/lib/observability/errors";
import type { Me, OnboardingState, SpaceId } from "../contracts";
import { readLastSpaceCookie, serializeLastSpaceCookie } from "../client/spaces-selection";
import { demoPathAllowed } from "@/lib/staging-demo-policy";
import { qaPathAllowed } from "@/lib/staging-qa-policy";
import { stagingFixturePathAllowed } from "@/lib/staging-fixture-policy";
import {
  acknowledgedRole, grantedHintSpace, parseWelcomeHint, selectLandingSpace, WELCOME_LEGACY_PATHS, welcomeDue,
} from "./onboarding-routing";
import { getSpaceContext } from "./space-context";
import {
  canonicalSpacePath, isAvailableSpacePath, isNewSpacePath, legacySpacePath,
  normalizeSpacePath, SPACE_PATHS, spaceForPath, WELCOME_PATH,
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

/** Restricted test identities retain their exact existing surface boundaries. */
function reachableSpaces({ locals, request }: APIContext, spaces: readonly SpaceId[]): SpaceId[] {
  return spaces.filter(space => {
    const target = SPACE_PATHS[space];
    return (!locals.stagingQa || qaPathAllowed(locals.stagingQa.persona, target, request.method))
      && (!locals.stagingDemo || demoPathAllowed(target, request.method))
      && (!locals.stagingFixture || stagingFixturePathAllowed(target, request.method));
  });
}

/** Onboarding only steers the default choice, so a failed read falls back to the choice without it. */
async function landingOnboardingState(me: Me): Promise<OnboardingState | null> {
  if (!me.flags.onboarding) return null;
  try {
    return await getOnboardingState(env.DB, me.user.id);
  } catch (error) {
    // recordError never throws; it reports its own ledger failures.
    await recordError(env.DB, { source: "request", route: "/dashboard", error, level: "warning" });
    return null;
  }
}

async function defaultSpaceResponse(context: APIContext, me: Me): Promise<Response> {
  const { locals, request, url, redirect } = context;
  const onboarding = await landingOnboardingState(me);
  if (onboarding && welcomeDue(locals, me, onboarding)) return privateResponse(redirect(WELCOME_PATH + url.search, 302));
  const lastSpace = readLastSpaceCookie(request.headers.get("cookie"));
  const selected = selectLandingSpace(reachableSpaces(context, me.spaces), lastSpace, onboarding);
  return selected ? privateResponse(redirect(SPACE_PATHS[selected] + url.search, 302)) : denial(403);
}

/**
 * `/dashboard/welcome` (onboarding SPEC §2, §3). The page itself (U-O.1) refuses delegated callers.
 * - Onboarding off: a partner-page hint takes its legacy route; anything else is 404.
 * - On: a hint naming an access role already held goes to that space. Otherwise the page renders,
 *   and the hint only preselects a card.
 */
async function welcomeResponse(context: APIContext, next: MiddlewareNext): Promise<Response> {
  const { request, url } = context;
  const read = request.method === "GET" || request.method === "HEAD";
  const hint = read ? parseWelcomeHint(url.searchParams) : null;
  const legacy = () => hint ? privateResponse(context.redirect(WELCOME_LEGACY_PATHS[hint], 302)) : denial(404);
  let me;
  try {
    me = await getSpaceContext(context);
  } catch (error) {
    if (error instanceof Response) return error.status === 404 ? legacy() : privateResponse(error);
    // A hinted link still lands on the page that enforces its own access; the step itself fails closed.
    if (hint) return legacy();
    throw error;
  }
  if (!me.flags.onboarding) return legacy();
  const granted = grantedHintSpace(hint, reachableSpaces(context, me.spaces));
  if (granted) return privateResponse(context.redirect(SPACE_PATHS[granted], 302));
  return privateResponse(await next());
}

/**
 * Opening the space an approval unlocked is what makes that approval seen (onboarding SPEC §3), so
 * `/dashboard` stops preferring it. The page has already rendered; a failed write only means the
 * preference applies once more.
 */
async function acknowledgeApproval({ locals }: APIContext, me: Me, space: SpaceId): Promise<void> {
  const role = acknowledgedRole(space, me, locals);
  if (!role) return;
  try {
    await markAccessRequestSeen(env.DB, me.user.id, { role });
  } catch (error) {
    await recordError(env.DB, { source: "request", route: SPACE_PATHS[space], error, level: "warning" });
  }
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
    if (request.method === "GET" && me.flags.onboarding) await acknowledgeApproval(context, me, space);
  }
  return response;
}

/** Boundary checks must precede this helper, including in the QA authentication branch. */
export async function routeSpaceRequest(context: APIContext, next: MiddlewareNext): Promise<Response> {
  const { request, url } = context;
  const path = normalizeSpacePath(url.pathname);
  const canonical = canonicalSpacePath(path);
  if (path === WELCOME_PATH) return welcomeResponse(context, next);
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
