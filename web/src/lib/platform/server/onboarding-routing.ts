import { isAgentSession } from "@/lib/agent-auth";
import { unseenApprovals } from "@/lib/onboarding/service";
import { preferredSpace, selectDefaultSpace } from "../client/spaces-selection";
import { AccessRole, InferredIntent, type Me, type OnboardingState, type SpaceId } from "../contracts";

/**
 * Onboarding routing (B-O.4, onboarding SPEC §3). Intents and requests choose where a person starts;
 * they never decide what a person may open. Every space passed in here is already authorized.
 */

/** The space each access role opens once granted. */
export const ROLE_SPACES = { MENTOR: "mentoring", INSTITUTION: "discover" } as const satisfies Record<AccessRole, SpaceId>;

/**
 * Where `/dashboard/welcome?intent=` lands while onboarding is off, so the partner-page links
 * (`/auth/login?next=/dashboard/welcome?intent=…`) never 404. These are the pages they reach today.
 */
export const WELCOME_LEGACY_PATHS = {
  MEMBER: "/dashboard",
  MENTOR: "/dashboard/mentorship",
  INSTITUTION: "/dashboard/discover",
} as const satisfies Record<InferredIntent, string>;

/** `?intent=mentor|institution|member`, in any case, as the welcome page reads it. Anything else is no hint. */
export function parseWelcomeHint(params: URLSearchParams): InferredIntent | null {
  const parsed = InferredIntent.safeParse(params.get("intent")?.toUpperCase());
  return parsed.success ? parsed.data : null;
}

/** The space a hint names, when it is an access role the person already holds. */
export function grantedHintSpace(hint: InferredIntent | null, spaces: readonly SpaceId[]): SpaceId | null {
  const role = AccessRole.safeParse(hint);
  if (!role.success) return null;
  const space = ROLE_SPACES[role.data];
  return spaces.includes(space) ? space : null;
}

type RoutingLocals = Pick<App.Locals, "personalAccessToken" | "session" | "stagingDemo" | "stagingFixture" | "stagingQa">;

/**
 * Only a person in their own browser: never a personal access token, an agent's delegated session
 * (including preview personas) or a restricted staging identity (QA, demo, fixture).
 */
export function isPersonalBrowser(locals: RoutingLocals): boolean {
  return !locals.personalAccessToken && !isAgentSession(locals.session?.userAgent)
    && !locals.stagingQa && !locals.stagingDemo && !locals.stagingFixture;
}

/**
 * Whether `GET /dashboard` sends this account to the welcome step: a NEW account (created while
 * onboarding was open) that nothing places yet. Admins, roles granted ahead of time and any cohort
 * footprint (an application, membership or assignment) all place an account. Callers handle deep
 * links and POSTs by only asking for `GET /dashboard`.
 */
export function welcomeDue(locals: RoutingLocals, me: Me, state: OnboardingState): boolean {
  const { isAdmin, isMentor, isInstitution } = me.capabilities;
  return state.stage === "NEW" && isPersonalBrowser(locals)
    && !isAdmin && !isMentor && !isInstitution && !me.spaces.includes("cohort");
}

/**
 * The space `/dashboard` opens, from the authorized `spaces`:
 * 1. an unseen approval, once (visiting the space or dismissing its card marks it seen);
 * 2. the last-space cookie, except a stale `admin`: Admin lives at /admin, outside the cookie's
 *    Path=/dashboard, so nothing there can replace it;
 * 3. the space the person's saved (or else inferred) intents prefer;
 * 4. SPACE_ORDER.
 * An explicit URL beats all of these because it never reaches this choice. `onboarding` is null
 * while the flag is off, which leaves the cookie (bar admin) and SPACE_ORDER.
 */
export function selectLandingSpace(
  spaces: readonly SpaceId[], lastSpace: SpaceId | null, onboarding: OnboardingState | null,
): SpaceId | null {
  const announced = onboarding && unseenApprovals(onboarding).map(role => ROLE_SPACES[role]).find(space => spaces.includes(space));
  if (announced) return announced;
  const staleAdmin = lastSpace === "admin" && spaces.some(space => space !== "admin");
  const intents = onboarding && (onboarding.intents.length > 0 ? onboarding.intents : onboarding.inferred);
  return selectDefaultSpace(spaces, {
    lastSpace: staleAdmin ? null : lastSpace,
    preferred: intents ? preferredSpace(intents, spaces) : null,
  });
}

/**
 * The access role whose approval a visit to `space` acknowledges, if the person holds it now. A visit
 * by anyone else (an admin browsing Discover, a delegated session) acknowledges nothing.
 */
export function acknowledgedRole(space: SpaceId, me: Me, locals: RoutingLocals): AccessRole | null {
  if (!isPersonalBrowser(locals)) return null;
  if (space === ROLE_SPACES.MENTOR && me.capabilities.isMentor) return "MENTOR";
  if (space === ROLE_SPACES.INSTITUTION && me.capabilities.isInstitution) return "INSTITUTION";
  return null;
}
