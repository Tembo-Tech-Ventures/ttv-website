import { recordError } from "@/lib/observability/errors";
import { getFlags, type FlagContext } from "@/lib/platform/server/flags";
import type { PartnerAccessFlow } from "./CommunityPartnerPage";

/**
 * Stands in for the account an anonymous visitor has yet to sign in with. It is never stored or
 * looked up: with `isAdmin: false` the flags read only audiences, so it asks what signing in opens
 * for an ordinary member (audience ALL, or a non-production override), never STAFF.
 */
const ORDINARY_MEMBER = { id: "partner-page-visitor" } as const;

/**
 * Which access story the partner pages tell (see `PartnerAccessFlow`): the request a person sends
 * from the welcome step while onboarding is on for them, otherwise the legacy page. A signed-in
 * visitor gets their own flags. An anonymous visitor's flags are all off by design, but the copy
 * describes what happens after they sign in, so they get an ordinary member's. A failed read keeps
 * the legacy story, which is what production shows until onboarding opens.
 */
export async function partnerAccessFlow({ locals, db, env, route }: {
  locals: Pick<App.Locals, "user" | "isAdmin">;
  db: D1Database;
  env: FlagContext["env"];
  /** The partner page, for the error ledger. */
  route: string;
}): Promise<PartnerAccessFlow> {
  const context: FlagContext = locals.user
    ? { db, env, user: locals.user, isAdmin: locals.isAdmin, locals }
    : { db, env, user: ORDINARY_MEMBER, isAdmin: false };
  try {
    return (await getFlags(context)).onboarding ? "request" : "legacy";
  } catch (error) {
    // recordError never throws; it reports its own ledger failures.
    await recordError(db, { source: "request", route, error, level: "warning" });
    return "legacy";
  }
}
