import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { drizzle } from "drizzle-orm/d1";
import * as schema from "./db/schema";

type AuthRuntimeEnv = Pick<
  Cloudflare.Env,
  | "DB"
  | "BETTER_AUTH_SECRET"
  | "BETTER_AUTH_URL"
  | "GITHUB_CLIENT_ID"
  | "GITHUB_CLIENT_SECRET"
>;

/**
 * Creates a BetterAuth instance bound to the given D1 database.
 * Must be called per-request since D1 bindings and secrets are request-scoped in Cloudflare Workers.
 */
export function createAuth(runtimeEnv: AuthRuntimeEnv) {
  const db = drizzle(runtimeEnv.DB, { schema });

  return betterAuth({
    database: drizzleAdapter(db, {
      provider: "sqlite",
    }),
    socialProviders: {
      github: {
        clientId: runtimeEnv.GITHUB_CLIENT_ID,
        clientSecret: runtimeEnv.GITHUB_CLIENT_SECRET,
      },
    },
    basePath: "/api/auth",
    secret: runtimeEnv.BETTER_AUTH_SECRET,
    baseURL: runtimeEnv.BETTER_AUTH_URL,
    session: {
      cookieCache: {
        enabled: true,
        maxAge: 60 * 5, // 5 minutes
      },
    },
  });
}

export type Auth = ReturnType<typeof createAuth>;
