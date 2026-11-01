import type { BetterAuthOptions } from "better-auth";
import { recordError } from "@/lib/observability/errors";
import { isFlagEnabled } from "@/lib/platform/server/flags";
import { startOnboarding } from "./service";

export type SignUpEnv = Pick<Cloudflare.Env, "DB" | "DEPLOYMENT_ENVIRONMENT" | "PLATFORM_FLAGS_OVERRIDE">;

/**
 * Marks a brand-new account NEW, so its first visit to /dashboard goes to the welcome step, while
 * onboarding is effective for everyone: audience ALL (with spaces), or the non-production override.
 * A new account holds no roles yet, so STAFF never applies.
 *
 * Fails open: sign-up must never break here. Without a row the account is treated like one from
 * before rollout and is offered the one-time card instead.
 */
export async function startOnboardingForNewAccount(env: SignUpEnv, userId: string, now = Date.now()): Promise<void> {
  try {
    const open = await isFlagEnabled({ db: env.DB, env, user: { id: userId }, isAdmin: false }, "onboarding");
    if (open) await startOnboarding(env.DB, userId, now);
  } catch (error) {
    // recordError never throws; it reports its own ledger failures.
    await recordError(env.DB, { source: "request", route: "/api/auth/[...all]", error, level: "warning" });
  }
}

/** Better Auth database hooks for createAuth (src/lib/auth.ts). */
export function onboardingSignUpHooks(env: SignUpEnv): NonNullable<NonNullable<BetterAuthOptions["databaseHooks"]>["user"]> {
  return { create: { after: async (user) => startOnboardingForNewAccount(env, user.id) } };
}
