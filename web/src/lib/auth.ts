import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { drizzle } from "drizzle-orm/d1";
import * as schema from "./db/schema";

/**
 * Creates a BetterAuth instance bound to the given D1 database.
 * Must be called per-request since D1 bindings are request-scoped in Cloudflare Workers.
 */
export function createAuth(d1: D1Database) {
  const db = drizzle(d1, { schema });

  return betterAuth({
    database: drizzleAdapter(db, {
      provider: "sqlite",
    }),
    socialProviders: {
      github: {
        clientId: import.meta.env.GITHUB_CLIENT_ID ?? "",
        clientSecret: import.meta.env.GITHUB_CLIENT_SECRET ?? "",
      },
    },
    basePath: "/api/auth",
    secret: import.meta.env.BETTER_AUTH_SECRET,
    baseURL: import.meta.env.BETTER_AUTH_URL,
    session: {
      cookieCache: {
        enabled: true,
        maxAge: 60 * 5, // 5 minutes
      },
    },
  });
}

export type Auth = ReturnType<typeof createAuth>;
