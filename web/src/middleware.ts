import { defineMiddleware } from "astro:middleware";
import { env } from "cloudflare:workers";
import { createAuth } from "@/lib/auth";

export const onRequest = defineMiddleware(async (context, next) => {
  const { locals, request, url, redirect } = context;
  const auth = createAuth(env.DB);

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

  // Protect /admin/* routes — require ADMIN role
  if (url.pathname.startsWith("/admin")) {
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
  }

  return next();
});
