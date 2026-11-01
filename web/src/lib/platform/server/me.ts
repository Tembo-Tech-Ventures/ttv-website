import { drizzle } from "drizzle-orm/d1";
import { getAttentionCount } from "@/lib/attention/count";
import * as schema from "@/lib/db/schema";
import { awaitingConfirmation } from "@/lib/mentoring/awaiting";
import { Me, WebLink, type RoleBadge } from "../contracts";
import { capabilitiesFor } from "./capabilities";
import { getFlags, requireFlag, type FlagContext } from "./flags";
import { platformError } from "./http";
import { TEMBO_DAILY_LIMIT } from "./me-config";

export interface MeContext {
  db: D1Database;
  env: FlagContext["env"];
  locals: Pick<App.Locals, "user" | "isAdmin" | "personalAccessToken" | "session" | "stagingDemo" | "stagingFixture" | "stagingQa">
    & Partial<Pick<App.Locals, "cfContext">>;
}

/** Shared API/page loader. Denials throw a no-store Response; DB errors propagate. */
export async function getMe({ db, env, locals }: MeContext): Promise<Me> {
  const user = locals.user;
  // Signed-out callers have no effective flags, including on preview overrides.
  if (!user) throw platformError("flag_off", "Not found.", 404);
  const flagContext = { db, env, user, isAdmin: locals.isAdmin, locals };
  const denial = await requireFlag(flagContext, "spaces");
  if (denial) throw denial;

  if (locals.personalAccessToken) throw platformError("forbidden", "Not permitted.", 403);

  const database = drizzle(db, { schema });
  const canonical = await capabilitiesFor(database, user);
  const { spaces, ...capabilities } = canonical;
  const attention = await getAttentionCount(database, user.id, canonical);
  // Derived, not attention: see src/lib/mentoring/README.md.
  const awaiting = spaces.includes("mentoring") ? await awaitingConfirmation({ db, env, locals }) : null;
  // Only display roles established by the canonical capability lookup. Cohort
  // status/labels need richer display metadata; never infer them from cohortIds.
  const roleBadges: RoleBadge[] = [];
  if (capabilities.isInstitution) roleBadges.push({ kind: "INSTITUTION", label: "Institution partner", programId: null });
  if (capabilities.isMentor) roleBadges.push({ kind: "MENTOR", label: "Mentor", programId: null });
  if (capabilities.isAdmin) roleBadges.push(
    { kind: "STAFF", label: "Staff", programId: null },
    { kind: "ADMIN", label: "Admin", programId: null },
  );
  // Applicants and program members are not community-only. Until richer
  // program display metadata exists, omit their badges rather than mislabel.
  if (roleBadges.length === 0 && !spaces.includes("cohort")) {
    roleBadges.push({ kind: "COMMUNITY", label: "Community", programId: null });
  }
  const avatar = WebLink.safeParse(user.image);

  return Me.parse({
    user: { id: user.id, name: user.name.trim() || "Member", avatarUrl: avatar.success ? avatar.data : null, roleBadges },
    capabilities,
    spaces,
    flags: await getFlags(flagContext),
    unreadCounts: attention.unreadCounts,
    // Channel Tembo accounting arrives in Phase 3; not private-chat usage.
    temboUsage: { used: 0, limit: TEMBO_DAILY_LIMIT },
    ...(awaiting === null ? {} : { mentoring: { awaitingConfirmation: awaiting } }),
  });
}
