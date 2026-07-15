import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { bearer } from "better-auth/plugins";
import { drizzle } from "drizzle-orm/d1";
import { isAgentAuthEnabled } from "./agent-auth";
import * as schema from "./db/schema";

type AuthRuntimeEnv = Pick<
  Cloudflare.Env,
  | "DB"
  | "BETTER_AUTH_SECRET"
  | "BETTER_AUTH_URL"
  | "GITHUB_CLIENT_ID"
  | "GITHUB_CLIENT_SECRET"
  | "AGENT_AUTH_ENABLED"
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
    // Bearer sessions are a staging-only operational capability. Production
    // never receives AGENT_AUTH_ENABLED, so it keeps cookie-only auth.
    plugins: isAgentAuthEnabled(runtimeEnv.AGENT_AUTH_ENABLED) ? [bearer()] : [],
  });
}

export type Auth = ReturnType<typeof createAuth>;
