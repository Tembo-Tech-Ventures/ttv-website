import { userHasAdminRole } from "@/lib/admin/roles";
import { FlagKey, type FlagAudience } from "@/lib/platform/contracts";
import { platformError } from "./http";

export type { FlagKey, FlagAudience } from "@/lib/platform/contracts";
export type Flags = Record<FlagKey, boolean>;

export interface FlagContext {
  db: D1Database;
  env: Pick<Cloudflare.Env, "DEPLOYMENT_ENVIRONMENT" | "PLATFORM_FLAGS_OVERRIDE">;
  user: Pick<AuthUser, "id"> | null;
  /** Trusted ADMIN result from middleware or capabilitiesFor, when available. */
  isAdmin?: boolean;
  /** Pass Astro.locals to share the cache across helpers in the same request. */
  locals?: object;
}

// Weak keys avoid retaining requests. Never key by DB, user ID or environment:
// audience changes must take effect on the very next request.
const requestFlags = new WeakMap<object, {
  userId: string | null;
  isAdmin: boolean | undefined;
  flags: Promise<Flags>;
}>();

/** A flag listed here is effective only while the flag it builds on is (onboarding SPEC §6). */
const REQUIRES: Partial<Record<FlagKey, FlagKey>> = { onboarding: "spaces" };
const FLAG_KEY_PLACEHOLDERS = FlagKey.options.map(() => "?").join(", ");

function uniformFlags(enabled: boolean): Flags {
  return Object.fromEntries(FlagKey.options.map((key) => [key, enabled])) as Flags;
}

async function resolveFlags(ctx: FlagContext): Promise<Flags> {
  if (!ctx.user) return Object.freeze(uniformFlags(false));
  // Match scripts/cloudflare/lib.mjs normalizeSlug: these aliases target the
  // same production resources. Never trust the unnormalised deployment label.
  const environment = (ctx.env.DEPLOYMENT_ENVIRONMENT ?? "")
    .toLowerCase().replace(/[^a-z0-9-]+/g, "-")
    .replace(/^-+|-+$/g, "").replace(/-{2,}/g, "-");
  if (environment !== "production" && ctx.env.PLATFORM_FLAGS_OVERRIDE === "all") {
    return Object.freeze(uniformFlags(true));
  }

  const { results } = await ctx.db.prepare(
    `SELECT key, audience FROM feature_flag WHERE key IN (${FLAG_KEY_PLACEHOLDERS})`
  ).bind(...FlagKey.options).all<{ key: FlagKey; audience: FlagAudience }>();
  const isAdmin = results.some((flag) => flag.audience === "STAFF")
    ? ctx.isAdmin ?? await userHasAdminRole(ctx.db, ctx.user.id)
    : false;
  const flags = uniformFlags(false);
  for (const flag of results) {
    flags[flag.key] = flag.audience === "ALL" || (flag.audience === "STAFF" && isAdmin);
  }
  for (const key of FlagKey.options) {
    const required = REQUIRES[key];
    if (required) flags[key] &&= flags[required];
  }
  return Object.freeze(flags);
}

/** Reuse ctx/locals after authentication. Auth changes invalidate an early read. */
export function getFlags(ctx: FlagContext): Promise<Flags> {
  const cacheKey = ctx.locals ?? ctx;
  const userId = ctx.user?.id ?? null;
  let cached = requestFlags.get(cacheKey);
  if (!cached || cached.userId !== userId || cached.isAdmin !== ctx.isAdmin) {
    cached = { userId, isAdmin: ctx.isAdmin, flags: resolveFlags(ctx) };
    requestFlags.set(cacheKey, cached);
  }
  return cached.flags;
}

export async function isFlagEnabled(ctx: FlagContext, key: FlagKey): Promise<boolean> {
  return (await getFlags(ctx))[key];
}

/** Return early from API routes when non-null, before querying feature data. */
export async function requireFlag(ctx: FlagContext, key: FlagKey): Promise<Response | null> {
  return await isFlagEnabled(ctx, key)
    ? null
    : platformError("flag_off", "Not found.", 404);
}
