import { userHasAdminRole } from "@/lib/admin/roles";
import { FlagKey, type FlagAudience } from "./flag-contracts";
import { platformError } from "./http";

export type { FlagKey, FlagAudience } from "./flag-contracts";
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
const requestFlags = new WeakMap<object, Promise<Flags>>();

function uniformFlags(enabled: boolean): Flags {
  return { spaces: enabled, channels: enabled, tembo_channels: enabled, mentor_requests: enabled };
}

async function resolveFlags(ctx: FlagContext): Promise<Flags> {
  if (!ctx.user) return Object.freeze(uniformFlags(false));
  if (ctx.env.DEPLOYMENT_ENVIRONMENT !== "production" && ctx.env.PLATFORM_FLAGS_OVERRIDE === "all") {
    return Object.freeze(uniformFlags(true));
  }

  const { results } = await ctx.db.prepare(
    "SELECT key, audience FROM feature_flag WHERE key IN (?, ?, ?, ?)"
  ).bind(...FlagKey.options).all<{ key: FlagKey; audience: FlagAudience }>();
  const isAdmin = results.some((flag) => flag.audience === "STAFF")
    ? ctx.isAdmin ?? await userHasAdminRole(ctx.db, ctx.user.id)
    : false;
  const flags = uniformFlags(false);
  for (const flag of results) {
    flags[flag.key] = flag.audience === "ALL" || (flag.audience === "STAFF" && isAdmin);
  }
  return Object.freeze(flags);
}

/** Reuse ctx (or pass the same request's locals) for every call in a request. */
export function getFlags(ctx: FlagContext): Promise<Flags> {
  const cacheKey = ctx.locals ?? ctx;
  let flags = requestFlags.get(cacheKey);
  if (!flags) {
    flags = resolveFlags(ctx);
    requestFlags.set(cacheKey, flags);
  }
  return flags;
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
