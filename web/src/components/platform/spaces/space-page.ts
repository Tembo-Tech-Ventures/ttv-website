import { and, desc, eq } from "drizzle-orm";
import { env } from "cloudflare:workers";
import type { Me, SpaceId } from "@/lib/platform/contracts";
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
import type { StudentNextStep } from "@/lib/student/journey";
import { canRenderSpace } from "@/components/platform/shell/access";
import { onboardingView, type OnboardingView } from "@/components/platform/onboarding/framing";
import { onboardingOpen } from "@/components/platform/onboarding/welcome-flow";
import { PAGE_SPACES, SPACE_PAGE_PATHS, type SpacePageKey } from "./sidebar";

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
  let me: Me;
  try {
    me = await getSpaceContext({ locals });
  } catch {
    return null;
  }
  const space = pickSpace(me, page);
  return space ? { me, space, page, onboarding: await loadOnboarding(locals, me, space, page) } : null;
}

/**
 * Whether onboarding applies to this person and session at all: the flag is on
 * for them, and they are not a restricted synthetic identity, a personal access
 * token or an agent's delegated session (none of which chooses for a person).
 */
export function onboardingFor(locals: App.Locals, me: Me): boolean {
  const { qaPersona, demo, fixture } = restrictionsFor(locals);
  return onboardingOpen(me.flags)
    && !qaPersona && !demo && !fixture && !locals.personalAccessToken && !isAgentSession(locals.session?.userAgent);
}

/** The landing pages a person can arrive on, which carry the status cards and the one-time card, and Account. */
const ONBOARDING_PAGES: ReadonlySet<SpacePageKey> = new Set(["cohort", "journey", "mentoring", "discover", "account"]);

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
    return onboardingView(await getOnboardingState(env.DB, me.user.id), me);
  } catch (error) {
    // recordError never throws; it reports its own ledger failures.
    await recordError(env.DB, { source: "request", route: SPACE_PAGE_PATHS[page], error, level: "warning" });
    return null;
  }
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

/**
 * A next step in the spaces shell's words. The shell calls the cohort
 * assistant Ask Tembo (owner decision, 31 Oct 2026); the existing dashboard,
 * whose navigation still says Ask AI, keeps the journey's own wording.
 */
export function inSpacesWords(step: StudentNextStep): StudentNextStep {
  return { ...step, description: step.description.replaceAll("Ask AI", "Ask Tembo") };
}

/** The person's own completed cohorts that have a certificate, newest first. */
export async function loadCertificates(db: Database, userId: string): Promise<{ id: string; programName: string }[]> {
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
