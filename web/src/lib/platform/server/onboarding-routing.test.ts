import { describe, expect, it } from "vitest";
import type { AccessRequestSummary, AccessRole, Me, OnboardingState, SpaceId } from "../contracts";
import {
  acknowledgedRole, grantedHintSpace, isPersonalBrowser, parseWelcomeHint, selectLandingSpace, WELCOME_LEGACY_PATHS, welcomeDue,
} from "./onboarding-routing";

const T = 1_793_500_000_000;
function request(role: AccessRole, status: AccessRequestSummary["status"], seenAt: number | null = null): AccessRequestSummary {
  const decided = status === "APPROVED" || status === "DECLINED";
  return {
    id: `request-${role.toLowerCase()}`, role, status, note: "Synthetic note long enough to be valid.",
    organisation: role === "INSTITUTION" ? "Synthetic Org" : null, organisationRole: null, link: null,
    decisionMessage: null, createdAt: T, updatedAt: T, decidedAt: decided ? T : null, seenAt,
  };
}
function state(input: Partial<OnboardingState> = {}): OnboardingState {
  return { stage: "DONE", intents: [], inferred: [], requests: [], roles: [], ...input };
}
type Locals = Parameters<typeof welcomeDue>[0];
const browser = { personalAccessToken: null, session: { userAgent: "Mozilla/5.0" }, stagingQa: null, stagingDemo: null, stagingFixture: null } as unknown as Locals;
/** The browser session with one difference. */
const withLocals = (difference: object) => ({ ...browser, ...difference }) as Locals;
/** Routing reads only spaces and capabilities from Me. */
function me(spaces: SpaceId[], capabilities: Partial<Me["capabilities"]> = {}): Me {
  return { spaces, capabilities: { cohortIds: [], mentorCohortIds: [], isMentor: false, isInstitution: false, isAdmin: false, ...capabilities } } as Me;
}

describe("parseWelcomeHint", () => {
  it.each([
    ["intent=mentor", "MENTOR"], ["intent=INSTITUTION", "INSTITUTION"], ["intent=Member", "MEMBER"],
    ["intent=exploring", null], ["intent=admin", null], ["intent=", null], ["", null], ["intent=mentor%00", null],
    ["intent=mentor&intent=institution", "MENTOR"], ["Intent=mentor", null],
  ])("%s → %s", (query, expected) => {
    expect(parseWelcomeHint(new URLSearchParams(query))).toBe(expected);
  });

  it("maps every hint to a legacy page that exists today", () => {
    expect(WELCOME_LEGACY_PATHS).toEqual({ MEMBER: "/dashboard", MENTOR: "/dashboard/mentorship", INSTITUTION: "/dashboard/discover" });
  });
});

describe("grantedHintSpace", () => {
  it.each([
    ["MENTOR", ["community", "mentoring", "profile"], "mentoring"],
    ["INSTITUTION", ["community", "discover", "profile"], "discover"],
    ["MENTOR", ["community", "discover", "profile"], null],
    ["INSTITUTION", ["community", "profile"], null],
    // MEMBER is not an access role: it only preselects, even for someone in a cohort.
    ["MEMBER", ["cohort", "community", "profile"], null],
    [null, ["cohort", "community", "mentoring", "discover", "profile"], null],
  ] as const)("%s with %j → %s", (hint, spaces, expected) => {
    expect(grantedHintSpace(hint, spaces)).toBe(expected);
  });
});

describe("selectLandingSpace precedence: unseen approval, cookie (bar admin), preferred, order", () => {
  const all: SpaceId[] = ["cohort", "community", "mentoring", "discover", "admin", "profile"];
  const approvedMentor = state({ roles: ["MENTOR"], requests: [request("MENTOR", "APPROVED")] });
  it.each<[string, SpaceId[], SpaceId | null, OnboardingState | null, SpaceId | null]>([
    ["flag off, no cookie: SPACE_ORDER", all, null, null, "cohort"],
    ["flag off, cookie wins", all, "community", null, "community"],
    ["flag off, stale admin cookie ignored", all, "admin", null, "cohort"],
    ["admin cookie kept when Admin is the only space", ["admin"], "admin", null, "admin"],
    ["unseen approval beats the cookie", all, "community", approvedMentor, "mentoring"],
    ["unseen approval beats preferred", all, null, { ...approvedMentor, intents: ["INSTITUTION"] }, "mentoring"],
    ["a seen approval no longer wins", all, "community", state({ roles: ["MENTOR"], requests: [request("MENTOR", "APPROVED", T)] }), "community"],
    ["an approval whose role was revoked does not win", ["community", "profile"], "profile", state({ requests: [request("MENTOR", "APPROVED")] }), "profile"],
    ["an approval for a space this identity cannot reach does not win", ["community", "profile"], null, approvedMentor, "community"],
    ["a declined request never wins", all, "community", state({ requests: [request("MENTOR", "DECLINED")] }), "community"],
    ["mentoring outranks discover among unseen approvals", all, null,
      state({ roles: ["MENTOR", "INSTITUTION"], requests: [request("MENTOR", "APPROVED"), request("INSTITUTION", "APPROVED")] }), "mentoring"],
    ["cookie beats preferred", all, "community", state({ intents: ["MENTOR"] }), "community"],
    ["stale admin cookie falls through to preferred", all, "admin", state({ intents: ["INSTITUTION"] }), "discover"],
    ["preferred from saved intents", all, null, state({ intents: ["MEMBER", "INSTITUTION"] }), "discover"],
    ["preferred from inferred intents when nothing is saved", all, null, state({ stage: "PROMPT", inferred: ["MENTOR"] }), "mentoring"],
    ["saved intents replace inferred ones", all, null, state({ intents: ["EXPLORING"], inferred: ["MENTOR"] }), "community"],
    ["an ungranted preference is ignored", ["community", "profile"], null, state({ intents: ["MENTOR"] }), "community"],
    ["no intents at all: SPACE_ORDER", all, null, state(), "cohort"],
    ["an inaccessible cookie falls through", ["community", "profile"], "mentoring", state(), "community"],
    ["nothing reachable", [], "community", approvedMentor, null],
  ])("%s", (_name, spaces, cookie, onboarding, expected) => {
    expect(selectLandingSpace(spaces, cookie, onboarding)).toBe(expected);
  });
});

describe("welcomeDue: only a NEW account that nothing places, in its own browser", () => {
  const fresh = state({ stage: "NEW" });
  const member = me(["community", "profile"]);
  it.each<[string, Parameters<typeof welcomeDue>[0], Me, OnboardingState, boolean]>([
    ["a fresh account", browser, member, fresh, true],
    ["a DONE account", browser, member, state({ stage: "DONE" }), false],
    ["an account from before rollout", browser, member, state({ stage: "PROMPT" }), false],
    ["an admin", browser, me(["cohort", "community", "discover", "admin", "profile"], { isAdmin: true }), fresh, false],
    ["a pre-granted mentor", browser, me(["community", "mentoring", "profile"], { isMentor: true }), fresh, false],
    ["a pre-granted institution", browser, me(["community", "discover", "profile"], { isInstitution: true }), fresh, false],
    ["an applicant", browser, me(["cohort", "community", "profile"]), fresh, false],
    ["a cohort member", browser, me(["cohort", "community", "profile"], { cohortIds: ["cohort-a"] }), fresh, false],
    ["a personal access token", withLocals({ personalAccessToken: { scopes: [] } }), member, fresh, false],
    ["an agent session", withLocals({ session: { userAgent: "ttv-agent:session:label" } }), member, fresh, false],
    ["a preview persona", withLocals({ session: { userAgent: "ttv-agent:isolated-preview:persona" } }), member, fresh, false],
    ["a QA persona", withLocals({ stagingQa: { persona: "member-noncohort" } }), member, fresh, false],
    ["a demo persona", withLocals({ stagingDemo: { persona: "member-noncohort" } }), member, fresh, false],
    ["a fixture persona", withLocals({ stagingFixture: { persona: "member" } }), member, fresh, false],
  ])("%s → %s", (_name, locals, person, onboarding, expected) => {
    expect(welcomeDue(locals, person, onboarding)).toBe(expected);
  });

  it("treats a session without a user agent as a browser", () => {
    expect(isPersonalBrowser(withLocals({ session: { userAgent: null } }))).toBe(true);
    expect(isPersonalBrowser(withLocals({ session: null }))).toBe(true);
  });
});

describe("acknowledgedRole: only the holder's own visit acknowledges", () => {
  it.each<[string, SpaceId, Me, Parameters<typeof acknowledgedRole>[2], AccessRole | null]>([
    ["mentor in Mentoring", "mentoring", me(["community", "mentoring", "profile"], { isMentor: true }), browser, "MENTOR"],
    ["institution in Discover", "discover", me(["community", "discover", "profile"], { isInstitution: true }), browser, "INSTITUTION"],
    ["admin without the role in Discover", "discover", me(["community", "discover", "admin", "profile"], { isAdmin: true }), browser, null],
    ["mentor in Community", "community", me(["community", "mentoring", "profile"], { isMentor: true }), browser, null],
    ["mentor in Discover", "discover", me(["community", "mentoring", "profile"], { isMentor: true }), browser, null],
    ["agent session", "mentoring", me(["community", "mentoring", "profile"], { isMentor: true }), withLocals({ session: { userAgent: "ttv-agent:x" } }), null],
    ["fixture persona", "discover", me(["community", "discover", "profile"], { isInstitution: true }), withLocals({ stagingFixture: { persona: "institution" } }), null],
  ])("%s → %s", (_name, space, person, locals, expected) => {
    expect(acknowledgedRole(space, person, locals)).toBe(expected);
  });
});
