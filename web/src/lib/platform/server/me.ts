import { drizzle } from "drizzle-orm/d1";
import * as schema from "@/lib/db/schema";
import { Me, type RoleBadge } from "../contracts";
import { capabilitiesFor } from "./capabilities";
import { getFlags, requireFlag, type FlagContext } from "./flags";
import { platformError } from "./http";

export interface MeContext {
  db: D1Database;
  env: FlagContext["env"];
  locals: Pick<App.Locals, "user" | "isAdmin">;
}

/** Shared API/page loader. Denials throw a no-store Response; DB errors propagate. */
export async function getMe({ db, env, locals }: MeContext): Promise<Me> {
  const user = locals.user;
  // Signed-out callers have no effective flags, including on preview overrides.
  if (!user) throw platformError("flag_off", "Not found.", 404);
  const flagContext = { db, env, user, isAdmin: locals.isAdmin, locals };
  const denial = await requireFlag(flagContext, "spaces");
  if (denial) throw denial;

  const { spaces, ...capabilities } = await capabilitiesFor(drizzle(db, { schema }), user);
  // Only display roles established by the canonical capability lookup. Cohort
  // status/labels need richer display metadata; never infer them from cohortIds.
  const roleBadges: RoleBadge[] = [];
  if (capabilities.isMentor) roleBadges.push({ kind: "MENTOR", label: "Mentor", programId: null });
  if (capabilities.isInstitution) roleBadges.push({ kind: "INSTITUTION", label: "Institution partner", programId: null });
  if (capabilities.isAdmin) roleBadges.push({ kind: "ADMIN", label: "Admin", programId: null });
  if (roleBadges.length === 0) roleBadges.push({ kind: "COMMUNITY", label: "Community", programId: null });

  return Me.parse({
    user: { id: user.id, name: user.name, avatarUrl: user.image ?? null, roleBadges },
    capabilities,
    spaces,
    flags: await getFlags(flagContext),
    // Until B-1.3 supplies the read-only attention ledger helper, all six
    // attention counts are zero. These are never channel unread counts.
    unreadCounts: { cohort: 0, community: 0, mentoring: 0, discover: 0, admin: 0, profile: 0 },
    // Channel Tembo accounting arrives in Phase 3; not private-chat usage.
    temboUsage: { used: 0, limit: 10 },
  });
}
