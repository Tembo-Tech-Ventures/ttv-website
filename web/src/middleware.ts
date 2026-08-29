import { defineMiddleware } from "astro:middleware";
import { env } from "cloudflare:workers";
import { createAuth } from "@/lib/auth";
import { isAgentSession } from "@/lib/agent-auth";
import { isHealthCheckPath } from "@/lib/health";
import { enforceAdminMutationOrigin } from "@/lib/admin/mutation-security";
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

  // Check admin role via D1 query
  const db = env.DB;
  const result = await db
    .prepare(
      `SELECT ur.id FROM "UserRoles" ur
       JOIN "Roles" r ON ur."roleId" = r."id"
       WHERE ur."userId" = ? AND r."name" = 'ADMIN'
       LIMIT 1`
    )
    .bind(locals.user.id)
    .first();

  if (!result) {
    return redirect("/dashboard");
  }

  locals.isAdmin = true;

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

export const onRequest = defineMiddleware(async (context, next) => {
  const { locals, request, url, redirect } = context;
  const primaryDomain = env.PRIMARY_DOMAIN;
  const redirectDomain = env.REDIRECT_DOMAIN;

  if (primaryDomain && redirectDomain && url.hostname === redirectDomain) {
    url.hostname = primaryDomain;
    url.protocol = "https:";
    return redirect(url.toString(), 301);
  }

  if (isHealthCheckPath(url.pathname)) {
    return next();
  }

  const authResult = await resolveAuthentication(env, request);
  locals.session = authResult.session;
  locals.user = authResult.user;
  locals.personalAccessToken = authResult.personalAccessToken;

  // Protect /dashboard/* routes — require authentication
  if (url.pathname.startsWith("/dashboard")) {
    if (!locals.user) {
      return redirect("/auth/login");
    }
  }

  // Protect /admin/* and /api/admin/* routes — require ADMIN role
  if (url.pathname.startsWith("/admin") || url.pathname.startsWith("/api/admin")) {
    const guardResponse = await enforceAdminGuards(context, locals);
    if (guardResponse) return guardResponse;
  }

  return next();
});
