import { drizzle } from "drizzle-orm/d1";
import { getAttentionCount } from "@/lib/attention/count";
import * as schema from "@/lib/db/schema";
import { awaitingConfirmation } from "@/lib/mentoring/awaiting";
import { Me, WebLink, type RoleBadge } from "../contracts";
import { getFlags, requireFlag, type FlagContext } from "./flags";
import { platformError } from "./http";
import { requestCapabilities } from "./request-capabilities";
import { requestScopeActive } from "./request-scope";
import { readTemboUsage, usageOf } from "@/lib/tembo/quota";

export interface MeContext {
  db: D1Database;
  env: FlagContext["env"];
  locals: Pick<App.Locals, "user" | "isAdmin" | "personalAccessToken" | "session" | "stagingDemo" | "stagingFixture" | "stagingQa">
    & Partial<Pick<App.Locals, "cfContext">>;
}

/** PERF-1: today's Tembo usage, read alongside attention instead of after it. */
function earlyTemboUsage(db: D1Database, flagContext: FlagContext, userId: string) {
  const now = Date.now();
  return quiet(getFlags(flagContext).then(flags =>
    flags.tembo_channels && flags.channels ? readTemboUsage(db, userId, now) : usageOf(0, now)));
}

/** Started early and awaited later: a rejection before then is not unhandled. */
function quiet<T>(promise: Promise<T>): Promise<T> {
  promise.catch(() => {});
  return promise;
}

/** Shared API/page loader. Denials throw a no-store Response; DB errors propagate. */
export async function getMe({ db, env, locals }: MeContext): Promise<Me> {
  const user = locals.user;
  // Signed-out callers have no effective flags, including on preview overrides.
  if (!user) throw platformError("flag_off", "Not found.", 404);
  const flagContext = { db, env, user, isAdmin: locals.isAdmin, locals };
  const database = drizzle(db, { schema });
  // PERF-1: inside a request scope (GET), flags and capabilities are read together, then the
  // per-space facts together: two round trips instead of five. The flag still decides first.
  const parallel = requestScopeActive();
  const early = parallel ? quiet(requestCapabilities(database, locals)) : null;
  const denial = await requireFlag(flagContext, "spaces");
  if (denial) throw denial;

  if (locals.personalAccessToken) throw platformError("forbidden", "Not permitted.", 403);

  const canonical = await (early ?? requestCapabilities(database, locals));
  const { spaces, ...capabilities } = canonical;
  const usage = parallel ? earlyTemboUsage(db, flagContext, user.id) : null;
  const attentionRead = getAttentionCount(database, user.id, canonical);
  if (!parallel) await attentionRead;
  // Derived, not attention: see src/lib/mentoring/README.md.
  const awaitingRead = spaces.includes("mentoring") ? awaitingConfirmation({ db, env, locals }) : Promise.resolve(null);
  const [attention, awaiting] = await Promise.all([attentionRead, awaitingRead]);
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

  const stored = await getFlags(flagContext);
  // Tembo in channels needs channels: without it every Tembo route is 404, so /me says off too (QA3-17).
  const flags = { ...stored, tembo_channels: stored.tembo_channels && stored.channels };
  const now = Date.now();
  return Me.parse({
    user: { id: user.id, name: user.name.trim() || "Member", avatarUrl: avatar.success ? avatar.data : null, roleBadges },
    capabilities,
    spaces,
    flags,
    unreadCounts: attention.unreadCounts,
    // Questions to Tembo in channels today (src/lib/tembo), not private-chat usage; read only while Tembo is on.
    temboUsage: usage ? await usage : flags.tembo_channels ? await readTemboUsage(db, user.id, now) : usageOf(0, now),
    ...(awaiting === null ? {} : { mentoring: { awaitingConfirmation: awaiting } }),
  });
}
