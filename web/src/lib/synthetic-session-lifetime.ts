import type { BetterAuthOptions } from "better-auth";
import { createAuthMiddleware } from "better-auth/api";
import { deleteSessionCookie } from "better-auth/cookies";

type FixtureSession = { id: string; userId: string; userAgent?: string | null; createdAt: Date; expiresAt: Date };

function isSynthetic(current: FixtureSession) {
  const marker = current.userAgent;
  return (current.id === "ttv-agent-preview-session" && current.userId === "ttv-agent-preview-user" && marker === "ttv-agent:isolated-preview") ||
    (current.id.startsWith("ttv-fixture-session-journey-") && current.userId.startsWith("ttv-fixture-user-journey-") && marker === "ttv-agent:isolated-preview:persona") ||
    (current.userId.startsWith("ttv-feedback-run-") && current.id === `${current.userId}-session` && marker === "ttv-agent:isolated-feedback") ||
    (current.userId.startsWith("ttv-staging-fixture-") && marker?.startsWith("ttv-agent:synthetic-staging:"));
}

const applies = (environment: string | undefined, enabled: boolean) => enabled &&
  (environment === "staging" || /^agent-[a-z0-9-]+$/.test(environment ?? ""));

/** Also reject legacy extended sessions when no refresh would otherwise occur. */
export function syntheticSessionResponseHook(environment: string | undefined, enabled: boolean): BetterAuthOptions["hooks"] {
  if (!applies(environment, enabled)) return undefined;
  return { after: createAuthMiddleware(async ctx => {
    if (ctx.path !== "/get-session") return;
    // Never turn a failed refresh/revocation race into a successful session.
    const returned = ctx.context.returned;
    if (!returned || typeof returned !== "object" || !("session" in returned) || !returned.session) return;
    const result = ctx.context.session;
    if (!result || !isSynthetic(result.session)) return;
    // Cookie caching must not keep an old run alive after revocation/rotation.
    let authoritative;
    try {
      authoritative = await ctx.context.internalAdapter.findSession(result.session.token);
    } catch {
      authoritative = null;
    }
    if (!authoritative || authoritative.session.id !== result.session.id || !isSynthetic(authoritative.session)) {
      ctx.context.session = null;
      deleteSessionCookie(ctx);
      return ctx.json(null);
    }
    const deadline = Math.min(new Date(result.session.expiresAt).getTime(), new Date(authoritative.session.expiresAt).getTime(), new Date(authoritative.session.createdAt).getTime() + 8 * 3600_000);
    if (!Number.isFinite(deadline) || deadline <= Date.now()) {
      ctx.context.session = null;
      deleteSessionCookie(ctx);
      return ctx.json(null);
    }
    ctx.context.session = { ...authoritative, session: { ...authoritative.session, expiresAt: new Date(deadline) } };
    return ctx.json(ctx.context.session);
  }) };
}

/** Keep the fixture's original deadline; ordinary sessions retain normal refresh. */
export function syntheticSessionHooks(environment: string | undefined, enabled: boolean): BetterAuthOptions["databaseHooks"] {
  if (!applies(environment, enabled)) return undefined;
  return {
    session: {
      update: {
        before: async (data, ctx) => {
          const current = ctx?.context.session?.session;
          if (!current || !data.expiresAt) return { data };
          if (!isSynthetic(current)) return { data };
          const deadline = Math.min(new Date(current.expiresAt).getTime(), new Date(current.createdAt).getTime() + 8 * 3600_000, new Date(data.expiresAt).getTime());
          if (!Number.isFinite(deadline) || deadline <= Date.now()) return false;
          return { data: { ...data, expiresAt: new Date(deadline) } };
        },
      },
    },
  };
}
