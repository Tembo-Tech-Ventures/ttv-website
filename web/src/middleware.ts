import { validateDemoSession, DemoAccessError, DEMO_OPERATOR_COOKIE } from "@/lib/staging-demo-access";
import { demoPathAllowed } from "@/lib/staging-demo-policy";
import { defineMiddleware } from "astro:middleware";
import { env } from "cloudflare:workers";
import { createAuth } from "@/lib/auth";
import { resolveStagingFixtureIdentity, StagingFixtureAccessError } from "@/lib/staging-fixtures";
import { stagingFixturePathAllowed } from "@/lib/staging-fixture-policy";
import { isAgentSession } from "@/lib/agent-auth";
import { isHealthCheckPath } from "@/lib/health";
import { enforceAdminMutationOrigin } from "@/lib/admin/mutation-security";
import { userHasAdminRole } from "@/lib/admin/roles";
import {
  collapseRoutePattern,
  recordErrorInBackground,
} from "@/lib/observability/errors";
import {
  authenticatePersonalAccessToken,
  enforcePersonalAccessTokenMutationScope,
  hasPersonalAccessTokenAuthorization,
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
    };
  }

  if (personalAccessTokenAttempted) {
    // An explicit but invalid PAT must not silently fall back to a browser
    // cookie that happened to accompany the request.
    return { session: null, user: null, personalAccessToken };
  }

  const auth = createAuth(authEnv);
  const sessionData = await auth.api.getSession({
    headers: request.headers,
    query: { disableCookieCache: request.headers.get("cookie")?.includes(DEMO_OPERATOR_COOKIE + "=") ?? false },
  });
  return {
    session: sessionData?.session ?? null,
    user: sessionData?.user ?? null,
    personalAccessToken,
  };
}

async function enforceAdminGuards(
  context: Parameters<Parameters<typeof defineMiddleware>[0]>[0],
  locals: App.Locals
): Promise<Response | null> {
  const { request, url, redirect } = context;

  if (!locals.user) {
    return redirect("/auth/login");
  }

  if (!(await userHasAdminRole(env.DB, locals.user.id))) {
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

async function enforceStagingFixtureBoundary(locals: App.Locals, pathname: string): Promise<Response | null> {
  locals.stagingFixture = null;
  if (!locals.user) return null;
  try {
    locals.stagingFixture = await resolveStagingFixtureIdentity({
      db:env.DB,envName:env.DEPLOYMENT_ENVIRONMENT,user:locals.user,
      session:locals.session ?? {id:""},isPat:Boolean(locals.personalAccessToken),retainedProbeEnabled:env.STAGING_RETAINED_READ_PROBE_ENABLED,
    });
    if (locals.stagingFixture?.retainedReadProbe && !["/api/community/access", "/api/community/profiles", "/api/community/chat"].includes(pathname) && !/^\/api\/community\/profiles\/[^/]+$/.test(pathname)) throw new StagingFixtureAccessError();
    if (locals.stagingFixture && !stagingFixturePathAllowed(pathname)) throw new StagingFixtureAccessError();
    return null;
  } catch (error) {
    if (!(error instanceof StagingFixtureAccessError)) throw error;
    return new Response(error.message,{status:403,headers:{"Cache-Control":"no-store"}});
  }
}

async function enforceDemoBoundary(locals: App.Locals, request: Request, pathname: string) {
  // These endpoints independently validate the operator, allowing recovery after a persona expires.
  if (["/demo", "/api/demo/switch", "/api/demo/logout"].includes(pathname.replace(/\/$/, ""))) return null;
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

export const onRequest = defineMiddleware(async (context, next) => {
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

    const authResult = await resolveAuthentication(env, request);
    locals.session = authResult.session;
    locals.user = authResult.user;
    locals.personalAccessToken = authResult.personalAccessToken;

    const demoFailure = await enforceDemoBoundary(locals,request,url.pathname);
    if (demoFailure) return demoFailure;

    const fixtureFailure = await enforceStagingFixtureBoundary(locals,url.pathname);
    if (fixtureFailure) return fixtureFailure;

    // Community delegation never inherits the owner's unrelated application access.
    // Use Astro's normalized route pathname, as with the admin origin guards.
    if (locals.personalAccessToken && !locals.personalAccessToken.scopes.includes("admin:read")) {
      const communityApi = url.pathname === "/api/community" || url.pathname.startsWith("/api/community/");
      if (url.pathname !== "/api/mcp" && !communityApi) {
        return new Response("Forbidden: community token cannot access this route.", {
          status: 403, headers: { "Cache-Control": "no-store" },
        });
      }
    }

    // Protect /dashboard/* routes — require authentication
    if (url.pathname.startsWith("/dashboard")) {
      if (!locals.user) {
        const returnPath = `${url.pathname}${url.search}`;
        return redirect(`/auth/login?next=${encodeURIComponent(returnPath)}`);
      }
    }

    // Protect /admin/* and /api/admin/* routes — require ADMIN role
    if (
      url.pathname.startsWith("/admin") ||
      url.pathname.startsWith("/api/admin")
    ) {
      const guardResponse = await enforceAdminGuards(context, locals);
      if (guardResponse) return guardResponse;
    }

    const response = await next();
    if (response.status === 500) {
      recordErrorInBackground(locals.cfContext, env.DB, {
        source: "request",
        route: collapseRoutePattern(url.pathname),
        error: new Error("Request completed with HTTP 500"),
        version: env.DEPLOYMENT_VERSION,
      });
    }
    return response;
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
