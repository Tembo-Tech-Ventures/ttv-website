import { authenticateQaCookie, hasQaCookie, logoutQa, QaAccessError } from "@/lib/staging-qa-access";
import { qaPathAllowed } from "@/lib/staging-qa-policy";
import { validateDemoSession, DemoAccessError, DEMO_OPERATOR_COOKIE } from "@/lib/staging-demo-access";
import { demoPathAllowed } from "@/lib/staging-demo-policy";
import { defineMiddleware } from "astro:middleware";
import { env } from "cloudflare:workers";
import { createAuth } from "@/lib/auth";
import { readBrowserSession, withSessionCookies } from "@/lib/auth-session";
import { resolveStagingFixtureIdentity, StagingFixtureAccessError } from "@/lib/staging-fixtures";
import { stagingFixturePathAllowed } from "@/lib/staging-fixture-policy";
import { isAgentSession } from "@/lib/agent-auth";
import { resolveSamLogin, SamLoginAccessError } from "@/lib/sam-login/login";
import { isHealthCheckPath } from "@/lib/health";
import { firstRequestOfIsolate, perfPhase, perfTraceRequested, withPerfTrace } from "@/lib/observability/perf-trace";
import { enforceAdminMutationOrigin } from "@/lib/admin/mutation-security";
import { userHasAdminRole } from "@/lib/admin/roles";
import { drizzle } from "drizzle-orm/d1";
import * as schema from "@/lib/db/schema";
import { capabilitiesFor } from "@/lib/platform/server/capabilities";
import { requestScopeActive, withRequestScope } from "@/lib/platform/server/request-scope";
import { platformAdminApiDenial } from "@/lib/platform/server/http";
import { routeSpaceRequest } from "@/lib/platform/server/space-routing";
import { startAdminSpacePage } from "@/components/platform/spaces/space-page";
import {
  collapseRoutePattern,
  recordErrorInBackground,
} from "@/lib/observability/errors";
import {
  authenticatePersonalAccessToken,
  enforcePersonalAccessTokenMutationScope,
  hasPersonalAccessTokenAuthorization,
  personalAccessTokenFamily,
} from "@/lib/personal-access-tokens";

type AuthEnv = typeof env;

async function resolveAuthentication(authEnv: AuthEnv, request: Request) {
  const personalAccessTokenAttempted = hasPersonalAccessTokenAuthorization(request);
  const personalAccessTokenAuth = personalAccessTokenAttempted
    ? await authenticatePersonalAccessToken(authEnv.DB, request)
    : null;
  const personalAccessToken = personalAccessTokenAuth?.token ?? null;

  if (personalAccessTokenAuth) {
    return {
      session: personalAccessTokenAuth.session,
      user: personalAccessTokenAuth.user,
      personalAccessToken,
      sessionCookies: [],
    };
  }

  if (personalAccessTokenAttempted) {
    // An explicit but invalid PAT must not silently fall back to a browser
    // cookie that happened to accompany the request.
    return { session: null, user: null, personalAccessToken, sessionCookies: [] };
  }

  const { session, user, cookies } = await readBrowserSession(
    createAuth(authEnv),
    request.headers,
    request.headers.get("cookie")?.includes(DEMO_OPERATOR_COOKIE + "=") ?? false,
  );
  return { session, user, personalAccessToken, sessionCookies: cookies };
}

async function enforceAdminGuards(
  context: Parameters<Parameters<typeof defineMiddleware>[0]>[0],
  locals: App.Locals
): Promise<Response | null> {
  const { request, url, redirect } = context;

  if (!locals.user) {
    return redirect("/auth/login");
  }

  // A read-only request reuses the capabilities its space context reads next (request-scope.ts): the
  // same ADMIN role check, read fresh for this request.
  const isAdmin = requestScopeActive()
    ? (await capabilitiesFor(drizzle(env.DB, { schema }), locals.user)).isAdmin
    : await userHasAdminRole(env.DB, locals.user.id);
  if (!isAdmin) {
    return redirect("/dashboard");
  }

  locals.isAdmin = true;

  if (locals.personalAccessToken && !locals.personalAccessToken.scopes.includes("admin:read")) {
    return new Response("Forbidden: admin:read scope required.", { status: 403 });
  }

  if (
    (locals.personalAccessToken || isAgentSession(locals.session?.userAgent)) &&
    url.pathname.startsWith("/admin/personal-access-tokens")
  ) {
    return new Response(
      "Forbidden: delegated credentials cannot manage personal access tokens.",
      {
        status: 403,
        headers: {
          "Cache-Control": "no-store",
          "Content-Type": "text/plain; charset=utf-8",
        },
      }
    );
  }

  if (locals.personalAccessToken) {
    const scopeFailure = enforcePersonalAccessTokenMutationScope(
      request,
      url.pathname,
      locals.personalAccessToken
    );
    if (scopeFailure) return scopeFailure;
  }

  const originFailure = enforceAdminMutationOrigin(request, url.pathname, {
    allowOriginlessAuthorization: Boolean(locals.personalAccessToken),
  });
  if (originFailure) return originFailure;

  return null;
}

/** An admin page's GET starts its Admin space beside the ADMIN guard and the page's own reads. */
function startAdminPageReads(request: Request, url: URL, locals: App.Locals) {
  if (request.method === "GET" && !url.pathname.startsWith("/api/")) startAdminSpacePage(locals);
}

/** The channel APIs a channels token may call (src/lib/channels/http.ts checks each scope). */
const isChannelApi=(pathname:string)=>pathname==="/api/channels" || pathname.startsWith("/api/channels/") || pathname.startsWith("/api/messages/");

/** A community or channels token reaches only its own family's routes; admin tokens are checked by enforceAdminGuards. */
function enforceTokenDelegation(locals:App.Locals,request:Request,pathname:string):Response|null {
  if(!locals.personalAccessToken) return null;
  const family=personalAccessTokenFamily(locals.personalAccessToken.scopes);
  if(family==="admin") return null;
  if(family==="channels") {
    if(isChannelApi(pathname)) return null;
    return new Response("Forbidden: channels token cannot access this route.",{status:403,headers:{"Cache-Control":"no-store"}});
  }
  const api=pathname==="/api/community" || pathname.startsWith("/api/community/");
  const probePage=locals.stagingFixture?.retainedReadProbe && request.method==="GET" && pathname==="/dashboard/discover";
  if(pathname==="/api/mcp" || api || probePage) return null;
  return new Response("Forbidden: community token cannot access this route.",{status:403,headers:{"Cache-Control":"no-store"}});
}

async function enforceStagingFixtureBoundary(locals: App.Locals, pathname: string, method: string): Promise<Response | null> {
  locals.stagingFixture = null;
  if (!locals.user) return null;
  try {
    locals.stagingFixture = await resolveStagingFixtureIdentity({
      db:env.DB,envName:env.DEPLOYMENT_ENVIRONMENT,user:locals.user,
      session:locals.session ?? {id:""},isPat:Boolean(locals.personalAccessToken),retainedProbeEnabled:env.STAGING_RETAINED_READ_PROBE_ENABLED,
    });
    if (locals.stagingFixture?.retainedReadProbe && !["/dashboard/discover", "/api/community/access", "/api/community/profiles", "/api/community/chat"].includes(pathname) && !/^\/api\/community\/profiles\/[^/]+$/.test(pathname)) throw new StagingFixtureAccessError();
    if (locals.stagingFixture && !stagingFixturePathAllowed(pathname, method)) throw new StagingFixtureAccessError();
    return null;
  } catch (error) {
    if (!(error instanceof StagingFixtureAccessError)) throw error;
    return new Response(error.message,{status:403,headers:{"Cache-Control":"no-store"}});
  }
}

/** A SAM persona's session is valid only while its login is (src/lib/sam-login/README.md); other accounts pass untouched. */
async function enforceSamLogin(locals: App.Locals): Promise<Response | null> {
  locals.samLogin = null;
  if (!locals.user) return null;
  try {
    locals.samLogin = await resolveSamLogin({
      env, user: locals.user, session: locals.session ?? { id: "" }, viaPersonalAccessToken: Boolean(locals.personalAccessToken),
    });
    return null;
  } catch (error) {
    if (!(error instanceof SamLoginAccessError)) throw error;
    return new Response(error.message, { status: error.status, headers: { "Cache-Control": "no-store" } });
  }
}

async function enforceDemoBoundary(locals: App.Locals, request: Request, pathname: string) {
  // These endpoints independently validate the operator, allowing recovery after a persona expires.
  if (["/demo", "/api/demo/switch", "/api/demo/logout", "/api/demo/return"].includes(pathname.replace(/\/$/, ""))) return null;
  if (!locals.user) return null;
  try {
    locals.stagingDemo = await validateDemoSession(env, request, locals.user, locals.session ?? {id:""});
    if (locals.stagingDemo && !demoPathAllowed(pathname, request.method)) throw new DemoAccessError();
    return null;
  } catch (error) {
    if (!(error instanceof DemoAccessError)) throw error;
    return new Response(error.message, {status:error.status,headers:{"Cache-Control":"no-store"}});
  }
}

/** SAM persona logins, the retained demo and synthetic fixtures, in that order; the first refusal wins. */
async function enforceStagingBoundaries(locals: App.Locals, request: Request, pathname: string): Promise<Response | null> {
  return (await enforceSamLogin(locals))
    ?? (await enforceDemoBoundary(locals, request, pathname))
    ?? (await enforceStagingFixtureBoundary(locals, pathname, request.method));
}

const handleRequest = defineMiddleware(async (context, next) => {
  const { locals, request, url, redirect } = context;
  const primaryDomain = env.PRIMARY_DOMAIN;
  const redirectDomain = env.REDIRECT_DOMAIN;

  try {
    if (primaryDomain && redirectDomain && url.hostname === redirectDomain) {
      url.hostname = primaryDomain;
      url.protocol = "https:";
      return redirect(url.toString(), 301);
    }

    if (isHealthCheckPath(url.pathname)) {
      return await next();
    }

    if (hasQaCookie(request)) {
      try {
        const auth = await authenticateQaCookie(env, request);
        if (!auth || !qaPathAllowed(auth.qa.persona,url.pathname,request.method)) throw new QaAccessError();
        locals.user=auth.user;locals.session=auth.session;locals.personalAccessToken=null;locals.stagingQa=auth.qa;
        locals.stagingDemo=null;locals.stagingFixture=null;
        if(url.pathname==='/api/qa/logout') return await logoutQa(env,request,auth.qa);
        const response=await routeSpaceRequest(context, next);response.headers.set('Cache-Control','no-store');response.headers.set('Vary','Cookie');
        return response;
      } catch {
        return platformAdminApiDenial(
          new Response('Temporary persona QA access is unavailable or expired.', {status:403,headers:{'Cache-Control':'no-store'}}),
          url.pathname
        );
      }
    }
    const authResult = await perfPhase("auth", () => resolveAuthentication(env, request));
    locals.session = authResult.session;
    locals.user = authResult.user;
    locals.personalAccessToken = authResult.personalAccessToken;
    // Every answer from here carries the session cookies better-auth refreshed while reading, so the
    // next navigation is served from its cookie cache instead of D1 (auth-session.ts).
    const respond = (response: Response) => withSessionCookies(response, authResult.sessionCookies);

    const stagingFailure = await perfPhase("staging", () => enforceStagingBoundaries(locals, request, url.pathname));
    if (stagingFailure) return respond(platformAdminApiDenial(stagingFailure, url.pathname));

    // Community and channels delegation never inherits the owner's unrelated application access.
    // Use Astro's normalized route pathname, as with the admin origin guards.
    const delegationFailure = enforceTokenDelegation(locals,request,url.pathname);
    if(delegationFailure) return respond(platformAdminApiDenial(delegationFailure, url.pathname));

    // Protect /dashboard/* routes — require authentication
    if (url.pathname.startsWith("/dashboard")) {
      if (!locals.user) {
        const returnPath = `${url.pathname}${url.search}`;
        return respond(redirect(`/auth/login?next=${encodeURIComponent(returnPath)}`));
      }
    }

    // Protect /admin/* and /api/admin/* routes — require ADMIN role
    if (
      url.pathname.startsWith("/admin") ||
      url.pathname.startsWith("/api/admin")
    ) {
      // The Admin space's reads start beside the ADMIN guard, not after it: they read the same shared
      // flags and capabilities, and nothing they read is shown unless the guard passes.
      startAdminPageReads(request, url, locals);
      const guardResponse = await perfPhase("admin", () => enforceAdminGuards(context, locals));
      if (guardResponse) return respond(platformAdminApiDenial(guardResponse, url.pathname));
    }

    const response = await routeSpaceRequest(context, next);
    if (response.status === 500) {
      recordErrorInBackground(locals.cfContext, env.DB, {
        source: "request",
        route: collapseRoutePattern(url.pathname),
        error: new Error("Request completed with HTTP 500"),
        version: env.DEPLOYMENT_VERSION,
      });
    }
    return respond(response);
  } catch (error) {
    recordErrorInBackground(locals.cfContext, env.DB, {
      source: "request",
      route: collapseRoutePattern(url.pathname),
      error,
      version: env.DEPLOYMENT_VERSION,
    });
    throw error;
  }
});

/**
 * A GET or HEAD request runs in a request scope, which shares each user's capabilities across its
 * helpers (src/lib/platform/server/request-scope.ts). Outside production, a request with the
 * `ttv-perf` cookie is traced (src/lib/observability/perf-trace.ts).
 */
export const onRequest = defineMiddleware(async (context, next) => {
  const cold = firstRequestOfIsolate();
  // handleRequest answers every request with a Response; its type is the general middleware one.
  const handle = () => withRequestScope(context.request.method, async () => (await handleRequest(context, next)) as Response);
  return perfTraceRequested(env.DEPLOYMENT_ENVIRONMENT, context.request)
    ? withPerfTrace(env.DB, context.request, { cold }, handle)
    : handle();
});
