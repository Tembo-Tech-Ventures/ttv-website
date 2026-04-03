import { createAuth } from "@/lib/auth";
import { defineMiddleware } from "astro:middleware";

export const onRequest = defineMiddleware(async (context, next) => {
  const db = context.locals.runtime.env.DB;
  const auth = createAuth(db);

  // Resolve session from request cookies/headers
  const sessionData = await auth.api.getSession({
    headers: context.request.headers,
  });

  if (sessionData) {
    context.locals.user = sessionData.user;
    context.locals.session = sessionData.session;
  } else {
    context.locals.user = null;
    context.locals.session = null;
  }

  const pathname = context.url.pathname;

  // Protect /dashboard/* — must be authenticated
  if (pathname.startsWith("/dashboard")) {
    if (!sessionData) {
      return context.redirect("/auth/login");
    }
  }

  // Protect /admin/* — must be authenticated + ADMIN role
  if (pathname.startsWith("/admin")) {
    if (!sessionData) {
      return context.redirect("/auth/login");
    }

    // Check if user has ADMIN role by querying D1 directly
    const adminCheck = await db
      .prepare(
        `SELECT 1 FROM user_role
         INNER JOIN role ON role.id = user_role.role_id
         WHERE user_role.user_id = ? AND role.name = 'ADMIN'
         LIMIT 1`
      )
      .bind(sessionData.user.id)
      .first();

    if (!adminCheck) {
      return context.redirect("/");
    }
  }

  return next();
});
