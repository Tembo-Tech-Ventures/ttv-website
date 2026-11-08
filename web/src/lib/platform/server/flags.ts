import { drizzle } from "drizzle-orm/d1";
import { userHasAdminRole } from "@/lib/admin/roles";
import * as schema from "@/lib/db/schema";
import { FlagKey, type FlagAudience } from "@/lib/platform/contracts";
import { capabilitiesFor } from "./capabilities";
import { platformError } from "./http";
import { requestScopeActive } from "./request-scope";

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

/**
 * A flag listed here is effective only while the flag it builds on is: onboarding on spaces
 * (onboarding SPEC §6), and mentor requests on channels, because accepting one opens a conversation.
 */
const REQUIRES: Partial<Record<FlagKey, FlagKey>> = { onboarding: "spaces", mentor_requests: "channels" };
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
    ? ctx.isAdmin ?? await staffAudience(ctx.db, ctx.user.id)
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

/**
 * Whether a STAFF audience includes this person: the ADMIN role, read fresh for this request. A
 * read-only request takes it from the capabilities its helpers share (request-scope.ts).
 */
async function staffAudience(db: D1Database, userId: string): Promise<boolean> {
  return requestScopeActive()
    ? (await capabilitiesFor(drizzle(db, { schema }), { id: userId })).isAdmin
    : userHasAdminRole(db, userId);
}

/**
 * Reuse ctx/locals after authentication. Auth changes invalidate an early read. A read made without
 * a trusted ADMIN result serves callers that have one, and the other way round: it read the same
 * request's ADMIN role (staffAudience), so it can only disagree with a caller that says otherwise.
 * That lets an admin page start its flags beside the ADMIN guard instead of after it.
 */
export function getFlags(ctx: FlagContext): Promise<Flags> {
  const cacheKey = ctx.locals ?? ctx;
  const userId = ctx.user?.id ?? null;
  let cached = requestFlags.get(cacheKey);
  const adminDisagrees = cached?.isAdmin !== undefined && ctx.isAdmin !== undefined && cached.isAdmin !== ctx.isAdmin;
  if (!cached || cached.userId !== userId || adminDisagrees) {
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
