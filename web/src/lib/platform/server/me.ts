import { drizzle } from "drizzle-orm/d1";
import { getAttentionCount } from "@/lib/attention/count";
import * as schema from "@/lib/db/schema";
import { awaitingConfirmation } from "@/lib/mentoring/awaiting";
import { Me, WebLink, type RoleBadge } from "../contracts";
import { getFlags, requireFlag, type FlagContext } from "./flags";
import { platformError } from "./http";
import { requestCapabilities } from "./request-capabilities";
import { readTemboUsage, usageOf } from "@/lib/tembo/quota";

export interface MeContext {
  db: D1Database;
  env: FlagContext["env"];
  locals: Pick<App.Locals, "user" | "isAdmin" | "personalAccessToken" | "session" | "stagingDemo" | "stagingFixture" | "stagingQa">
    & Partial<Pick<App.Locals, "cfContext">>;
}

/** Started now, awaited later: a rejection before then is not unhandled, and still reaches the awaiting caller. */
function startedEarly<T>(promise: Promise<T>): Promise<T> {
  promise.catch(() => {});
  return promise;
}

/**
 * Shared API/page loader. Denials throw a no-store Response; DB errors propagate.
 *
 * Two rounds of reads (PERF-2): flags and capabilities together, then attention, mentoring and Tembo
 * usage together. The `spaces` flag still decides first: a refused caller gets the same denial as
 * before, and nothing read for them is returned. A personal access token is refused before any
 * capability is read for it.
 */
export async function getMe({ db, env, locals }: MeContext): Promise<Me> {
  const user = locals.user;
  // Signed-out callers have no effective flags, including on preview overrides.
  if (!user) throw platformError("flag_off", "Not found.", 404);
  const flagContext = { db, env, user, isAdmin: locals.isAdmin, locals };
  const database = drizzle(db, { schema });
  const capabilitiesRead = locals.personalAccessToken ? null : startedEarly(requestCapabilities(database, locals));
  const denial = await requireFlag(flagContext, "spaces");
  if (denial) throw denial;

  if (!capabilitiesRead) throw platformError("forbidden", "Not permitted.", 403);

  const canonical = await capabilitiesRead;
  const { spaces, ...capabilities } = canonical;
  const stored = await getFlags(flagContext);
  // Tembo in channels needs channels: without it every Tembo route is 404, so /me says off too (QA3-17).
  const flags = { ...stored, tembo_channels: stored.tembo_channels && stored.channels };
  const now = Date.now();
  const [attention, awaiting, temboUsage] = await Promise.all([
    getAttentionCount(database, user.id, canonical),
    // Derived, not attention: see src/lib/mentoring/README.md.
    spaces.includes("mentoring") ? awaitingConfirmation({ db, env, locals }) : null,
    // Questions to Tembo in channels today (src/lib/tembo), not private-chat usage; read only while Tembo is on.
    flags.tembo_channels ? readTemboUsage(db, user.id, now) : usageOf(0, now),
  ]);
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
    flags,
    unreadCounts: attention.unreadCounts,
    temboUsage,
    ...(awaiting === null ? {} : { mentoring: { awaitingConfirmation: awaiting } }),
  });
}
