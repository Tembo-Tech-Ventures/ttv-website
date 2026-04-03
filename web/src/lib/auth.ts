import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { drizzle } from "drizzle-orm/d1";

export function createAuth(d1: D1Database) {
  return betterAuth({
    database: drizzleAdapter(drizzle(d1), {
      provider: "sqlite",
    }),
    socialProviders: {
      github: {
        clientId: import.meta.env.GITHUB_CLIENT_ID,
        clientSecret: import.meta.env.GITHUB_CLIENT_SECRET,
      },
    },
    secret: import.meta.env.BETTER_AUTH_SECRET,
    baseURL: import.meta.env.BETTER_AUTH_URL,
    session: {
      cookieCache: {
        enabled: true,
        maxAge: 5 * 60, // 5 minutes
      },
    },
  });
}

export type Auth = ReturnType<typeof createAuth>;
export type Session = Auth extends { $Infer: { Session: infer S } } ? S : never;
