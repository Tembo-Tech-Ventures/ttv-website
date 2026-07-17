import { defineMiddleware } from "astro:middleware";
import { env } from "cloudflare:workers";
import { createAuth } from "@/lib/auth";
import { isHealthCheckPath } from "@/lib/health";
import { needsAdminContext } from "@/lib/admin-context";

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

  const auth = createAuth(env);

  // Get session for every request
  const sessionData = await auth.api.getSession({
    headers: request.headers,
  });

  locals.session = sessionData?.session ?? null;
  locals.user = sessionData?.user ?? null;

  // Protect /dashboard/* routes — require authentication
  if (url.pathname.startsWith("/dashboard")) {
    if (!locals.user) {
      return redirect("/auth/login");
    }
  }

  const isAdminRoute =
    url.pathname.startsWith("/admin") || url.pathname.startsWith("/api/admin");
  if (isAdminRoute && !locals.user) return redirect("/auth/login");

  // Chat uses the same role context to grant administrators access to all
  // approved transcript sources, without making the chat route admin-only.
  if (locals.user && needsAdminContext(url.pathname)) {
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

    locals.isAdmin = Boolean(result);
    if (isAdminRoute && !locals.isAdmin) return redirect("/dashboard");
  }

  return next();
});
