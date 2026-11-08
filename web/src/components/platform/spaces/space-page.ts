import { and, desc, eq, inArray } from "drizzle-orm";
import { env } from "cloudflare:workers";
import type { Me, OnboardingState, SpaceId } from "@/lib/platform/contracts";
import { getSpaceContext } from "@/lib/platform/server/space-context";
import { getOnboardingState } from "@/lib/onboarding/service";
import { recordError } from "@/lib/observability/errors";
import { isAgentSession } from "@/lib/agent-auth";
import * as schema from "@/lib/db/schema";
import type { Database } from "@/lib/db/schema";
import { DEMO_PREFIX, demoPathAllowed, isDemoUser } from "@/lib/staging-demo-policy";
import { qaPathAllowed } from "@/lib/staging-qa-policy";
import { stagingFixturePathAllowed } from "@/lib/staging-fixture-policy";
import { isValidCompletion } from "@/lib/talent/eligibility";
import { restrictedQaNextStep } from "@/lib/dashboard-presentation";
import { getStudentJourney, type StudentNextStep } from "@/lib/student/journey";
import { requestScopeActive, requestScoped } from "@/lib/platform/server/request-scope";
import { spaceForPath } from "@/lib/platform/server/space-routes";
import { channelsServer } from "@/components/channels/server";
import { drizzle } from "drizzle-orm/d1";
import { startAdminNavCounts } from "@/components/admin/admin-nav-server";
import { getFlags } from "@/lib/platform/server/flags";
import { requestCapabilities } from "@/lib/platform/server/request-capabilities";
import { canRenderSpace } from "@/components/platform/shell/access";
import { onboardingView, type OnboardingView } from "@/components/platform/onboarding/framing";
import { onboardingOpen } from "@/components/platform/onboarding/welcome-flow";
import { PAGE_SPACES, SPACE_PAGE_PATHS, type SpacePageKey } from "./sidebar";
import { chooseCohort, COHORT_APPLICATION_NOTE, type CohortApplicationStatus, type CohortHeading, type CohortMembership } from "./cohort-heading";

/**
 * How an existing dashboard page decides whether it renders inside the spaces
 * shell. The page files stay where they are: B-1.2 serves them at their
 * canonical space paths, and this only changes the frame around them.
 */

export interface SpacePageContext {
  me: Me;
  space: SpaceId;
  page: SpacePageKey;
  /** How onboarding frames this page, or null where it does not (onboarding SPEC §2, §3). */
  onboarding: OnboardingView | null;
}

/** The first of the page's spaces this person can open, or null for the existing dashboard. */
export function pickSpace(me: Me | null, page: SpacePageKey): SpaceId | null {
  return PAGE_SPACES[page].find((space) => canRenderSpace(me, space)) ?? null;
}

/**
 * The spaces context for this request, or null when the page keeps its
 * existing dashboard frame: the `spaces` flag is off for the person, the caller
 * is a personal access token (`Me` is browser-session only), or the context
 * could not be loaded. That last case is deliberate. B-1.2 lets a legacy URL
 * fall through to its unchanged handler when the context fails, after every
 * authentication boundary has run; the page then still enforces its own data
 * access and nothing here grants any. Canonical routes never get this far
 * without a context: the middleware fails them closed.
 */
export async function resolveSpacePage(locals: App.Locals, page: SpacePageKey): Promise<SpacePageContext | null> {
  return (await resolveSpacePageWith(locals, page, async () => null))?.[0] ?? null;
}

/**
 * resolveSpacePage, with the page's own reads started as soon as its `me` is known, beside onboarding,
 * instead of after it (PERF-2). `load` runs only when the page has a spaces context, so it may rely
 * on `me` for its flag and access checks; it must not depend on onboarding. Its errors propagate to
 * the page, as they would have read after the context.
 */
export async function resolveSpacePageWith<T>(
  locals: App.Locals,
  page: SpacePageKey,
  load: (me: Me) => Promise<T>,
): Promise<[SpacePageContext, T] | null> {
  let me: Me;
  try {
    me = await getSpaceContext({ locals });
  } catch {
    return null;
  }
  const space = pickSpace(me, page);
  if (!space) return null;
  startSpaceFrame(me, space);
  const [onboarding, loaded] = await Promise.all([loadOnboarding(locals, me, space, page), load(me)]);
  return [{ me, space, page, onboarding }, loaded];
}

/** What the frame's reads depend on: the parts of `Me` known once its flags and capabilities are read. */
export interface SpaceFrameFacts {
  user: Pick<Me["user"], "id">;
  flags: Pick<Me["flags"], "channels" | "mentor_requests">;
  spaces: readonly SpaceId[];
  capabilities: Pick<Me["capabilities"], "cohortIds">;
}

/**
 * The flags and capabilities getMe reads first, as frame facts, from the same shared reads (getFlags
 * and requestCapabilities cache them for the request), or null when there is no spaces frame for
 * this caller: signed out, a personal access token, or the `spaces` flag off.
 */
async function spaceFrameFacts(locals: App.Locals): Promise<(SpaceFrameFacts & Pick<Me, "flags">) | null> {
  const user = locals.user;
  if (!user || locals.personalAccessToken) return null;
  const [flags, capabilities] = await Promise.all([
    getFlags({ db: env.DB, env, user, isAdmin: locals.isAdmin, locals }),
    requestCapabilities(drizzle(env.DB, { schema }), locals),
  ]);
  return flags.spaces ? { user: { id: user.id }, flags, spaces: capabilities.spaces, capabilities } : null;
}

/** The page a path serves, for the frame's early reads; null where the path names no space page. */
const PAGE_BY_PATH: ReadonlyMap<string, SpacePageKey> = new Map(
  (Object.entries(SPACE_PAGE_PATHS) as [SpacePageKey, string][]).map(([page, path]) => [path, page]),
);

/**
 * For a space page's GET, once the router has started its context: starts the frame's reads
 * (startSpaceFrame) and the person's onboarding as soon as the flags and capabilities are read,
 * beside the rest of getMe, instead of after the page's frontmatter has the whole context. They are
 * the request's shared reads, so SpacePage and loadOnboarding get these same ones. The space is the
 * path's; where the page later picks another (Ask Tembo without a cohort), the early reads are
 * unused and the page reads its own. Failures are left to SpacePage, which reports them.
 */
export function startSpacePageFrame(locals: App.Locals, path: string): void {
  const space = spaceForPath(path);
  if (!space || !requestScopeActive()) return;
  void (async () => {
    const facts = await spaceFrameFacts(locals);
    if (!facts?.spaces.includes(space)) return;
    startSpaceFrame(facts, space);
    const page = PAGE_BY_PATH.get(path);
    if (onboardingFor(locals, facts) && (space === "community" || (page && ONBOARDING_PAGES.has(page)))) {
      onboardingState(facts.user.id).catch(() => {});
    }
  })().catch(() => {});
}

/**
 * Starts the reads SpacePage's frame makes (the journey, the sidebar's channels, the cohort heading,
 * certificates) as soon as the space is known, beside onboarding and the page's own reads, instead of
 * after the page's frontmatter. Only in a read-only request: there each read is shared for the
 * request (request-scope.ts), so SpacePage and the page get these same reads, and a POST still reads
 * them after its own writes. Each is subject to the same checks as in SpacePage, and errors are left
 * to SpacePage, which reports them.
 */
function startSpaceFrame(me: SpaceFrameFacts, space: SpaceId): void {
  if (!requestScopeActive()) return;
  const db = drizzle(env.DB, { schema });
  const reads: Promise<unknown>[] = [getStudentJourney(db, me.user.id)];
  if (me.flags.channels && (space === "community" || space === "cohort")) reads.push(channelsServer(env.DB, me).list());
  if (me.spaces.includes("cohort")) reads.push(loadCohortHeading(db, me));
  if (space === "profile") reads.push(loadCertificates(db, me.user.id));
  for (const read of reads) read.catch(() => {});
  if (space === "admin") startAdminNavCounts(me);
}

/**
 * For an admin page's GET, once the middleware's ADMIN guard has passed: starts the Admin space's
 * context and frame beside the page's own reads, which come first in its frontmatter. Every admin
 * page resolves this context (T14), and it is shared for the request (getSpaceContext,
 * request-scope.ts), so the page gets these same reads. Failures are left to the page, which treats
 * a missing context as the existing admin shell.
 */
export function startAdminSpacePage(locals: App.Locals): void {
  if (!requestScopeActive() || locals.personalAccessToken || !locals.user) return;
  getSpaceContext({ locals }).catch(() => {});
  // The frame needs only the flags and capabilities getMe reads first, not the counts it reads next.
  // These are the same shared reads, so the Admin space opens exactly when canRenderSpace says so.
  void (async () => {
    const facts = await spaceFrameFacts(locals);
    if (facts?.spaces.includes("admin")) startSpaceFrame(facts, "admin");
  })().catch(() => {});
}

/**
 * Whether onboarding applies to this person and session at all: the flag is on
 * for them, and they are not a restricted synthetic identity, a personal access
 * token or an agent's delegated session (none of which chooses for a person).
 */
export function onboardingFor(locals: App.Locals, me: Pick<Me, "flags">): boolean {
  const { qaPersona, demo, fixture } = restrictionsFor(locals);
  return onboardingOpen(me.flags)
    && !qaPersona && !demo && !fixture && !locals.personalAccessToken && !isAgentSession(locals.session?.userAgent);
}

/**
 * The landing pages a person can arrive on, which carry the status cards and the one-time card, Account,
 * and the Profile tab's Overview and public profile, which frame themselves for mentors and organisations (QAO-07).
 */
const ONBOARDING_PAGES: ReadonlySet<SpacePageKey> = new Set(["cohort", "journey", "mentoring", "discover", "account", "profile", "portfolio"]);

/**
 * The person's onboarding, read for the pages that show it: the landing pages,
 * Account, and every Community page, whose sidebar lists "Your requests".
 * Null while the `onboarding` flag is off for them, so those pages stay
 * exactly as they were. Restricted synthetic identities, agents' delegated
 * sessions and personal access tokens never see it either: none of them
 * chooses on a person's behalf. A failed read is recorded and the page keeps
 * the framing it had before onboarding; nothing here grants anything.
 */
export async function loadOnboarding(locals: App.Locals, me: Me, space: SpaceId, page: SpacePageKey): Promise<OnboardingView | null> {
  if (!onboardingFor(locals, me) || (!ONBOARDING_PAGES.has(page) && space !== "community")) return null;
  try {
    return onboardingView(await onboardingState(me.user.id), me);
  } catch (error) {
    // recordError never throws; it reports its own ledger failures.
    await recordError(env.DB, { source: "request", route: SPACE_PAGE_PATHS[page], error, level: "warning" });
    return null;
  }
}

/**
 * The person's onboarding state, read once in a read-only request (request-scope.ts), so the frame can
 * start it early (startSpacePageFrame). A GET's only onboarding write, an approval's seen marker, runs
 * after the response (space-routing.ts acknowledgeApproval), so nothing reads back its own write.
 */
function onboardingState(userId: string): Promise<OnboardingState> {
  return requestScoped(`onboarding:${userId}`, () => getOnboardingState(env.DB, userId));
}

export interface Restrictions {
  qaPersona?: Parameters<typeof qaPathAllowed>[0] | null;
  demo?: boolean;
  fixture?: boolean;
}

export function restrictionsFor(locals: App.Locals): Restrictions {
  return {
    qaPersona: locals.stagingQa?.persona ?? null,
    demo: Boolean(locals.stagingDemo),
    fixture: Boolean(locals.stagingFixture),
  };
}

/**
 * Restricted synthetic identities only see links their allowlists open, as
 * the existing dashboard does, so the sidebar never offers a dead end.
 */
export function linkAllowed({ qaPersona, demo, fixture }: Restrictions, href: string): boolean {
  const path = href.split(/[?#]/, 1)[0]!;
  return (!qaPersona || qaPathAllowed(qaPersona, path, "GET"))
    && (!demo || demoPathAllowed(path, "GET"))
    && (!fixture || stagingFixturePathAllowed(path, "GET"));
}

/**
 * The existing dashboard's links a QA persona or staging fixture may follow,
 * or undefined for everyone else (nothing is filtered). Demo sessions keep
 * their existing sidebar, as before.
 */
export function restrictedHrefs({ qaPersona, fixture }: Restrictions, hrefs: readonly string[]): string[] | undefined {
  return qaPersona || fixture ? hrefs.filter((href) => linkAllowed({ qaPersona, fixture }, href)) : undefined;
}

/**
 * The journey's next step, unless a restricted synthetic identity cannot
 * follow it. A QA persona keeps its existing replacement step; a staging
 * fixture gets the same way back to its journey, in words that fit it. Real
 * people (no restrictions) always get the step as it is.
 */
export function restrictedNextStep({ qaPersona, fixture }: Restrictions, step: StudentNextStep): StudentNextStep {
  const href = step.action.href;
  if (qaPersona) return restrictedQaNextStep(step, linkAllowed({ qaPersona }, href));
  if (!fixture || linkAllowed({ fixture }, href)) return step;
  return {
    title: "Explore your community journey",
    description: "This synthetic staging account supports community activities. Cohort sessions and account tools are not open to it.",
    detail: null,
    action: { href: "/dashboard/community", label: "Open my journey" },
  };
}

const MEMBER_STATUSES = Object.keys(COHORT_APPLICATION_NOTE) as CohortApplicationStatus[];

/**
 * The cohort the Cohort space is named for (T07): among the cohorts this person reads (capabilitiesFor's
 * cohortIds), those they were accepted onto or hold a role in. Null when they are in none of them.
 * An application of theirs still waiting, to any cohort, keeps Apply where it is (S2).
 */
export function loadCohortHeading(db: Database, me: Pick<SpaceFrameFacts, "user" | "capabilities">, now = Date.now()): Promise<CohortHeading | null> {
  return requestScoped(`cohort-heading:${me.user.id}`, () => readCohortHeading(db, me, now));
}

async function readCohortHeading(db: Database, me: Pick<SpaceFrameFacts, "user" | "capabilities">, now: number): Promise<CohortHeading | null> {
  const ids = me.capabilities.cohortIds;
  if (ids.length === 0) return null;
  const program = { columns: { name: true, startDate: true, endDate: true }, with: { curriculum: { columns: { title: true } } } } as const;
  const [applications, roles, waiting] = await Promise.all([
    db.query.programApplication.findMany({
      where: and(eq(schema.programApplication.userId, me.user.id), inArray(schema.programApplication.programId, ids),
        inArray(schema.programApplication.status, MEMBER_STATUSES)),
      columns: { programId: true, status: true }, with: { program },
    }),
    db.query.programRole.findMany({
      where: and(eq(schema.programRole.userId, me.user.id), inArray(schema.programRole.programId, ids)),
      columns: { programId: true }, with: { program },
    }),
    db.query.programApplication.findFirst({
      where: and(eq(schema.programApplication.userId, me.user.id), eq(schema.programApplication.status, "PENDING")),
      columns: { id: true },
    }),
  ]);
  const memberships = new Map<string, CohortMembership>();
  for (const row of [...applications, ...roles]) {
    if (!row.programId || !row.program) continue;
    const application = "status" in row ? row.status as CohortApplicationStatus : null;
    const known = memberships.get(row.programId);
    if (known) {
      known.application ??= application;
      continue;
    }
    memberships.set(row.programId, {
      programId: row.programId, name: row.program.name, curriculum: row.program.curriculum?.title ?? null,
      startDate: row.program.startDate, endDate: row.program.endDate, application,
    });
  }
  return chooseCohort([...memberships.values()], now, { applying: waiting !== undefined });
}

/** The person's own completed cohorts that have a certificate, newest first. */
export function loadCertificates(db: Database, userId: string): Promise<{ id: string; programName: string }[]> {
  return requestScoped(`certificates:${userId}`, () => readCertificates(db, userId));
}

async function readCertificates(db: Database, userId: string): Promise<{ id: string; programName: string }[]> {
  const applications = await db.query.programApplication.findMany({
    where: and(
      eq(schema.programApplication.userId, userId),
      eq(schema.programApplication.status, "COMPLETED"),
      isDemoUser(userId) ? eq(schema.programApplication.programId, DEMO_PREFIX + "program") : undefined,
    ),
    columns: { id: true, status: true, completedAt: true },
    with: { program: { columns: { name: true } } },
    orderBy: [desc(schema.programApplication.completedAt)],
  });
  return applications
    .filter((application) => isValidCompletion(application) && application.program)
    .map((application) => ({ id: application.id, programName: application.program!.name }));
}
