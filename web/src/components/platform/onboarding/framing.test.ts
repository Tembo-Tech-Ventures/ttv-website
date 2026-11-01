import { afterEach, describe, expect, it } from "vitest";
import type { OnboardingState, SpaceId } from "@/lib/platform/contracts";
import {
  createAccessRequest, dismissPrompt, getOnboardingState, markAccessRequestSeen, saveIntents, startOnboarding,
  withdrawAccessRequest,
} from "@/lib/onboarding/service";
import { onboardingDatabase } from "@/lib/onboarding/test-support";
import { cardsFor, communityFraming, effectiveIntents, heldChoices, offersCohort, onboardingView, yourSpaces } from "./framing";

/**
 * The landing pages' reading of onboarding (SPEC §2 S3–S5, §3), on B-O.2's
 * real service, so every state here is one the database can actually hold.
 * The rule throughout: cards about access follow the request and the role,
 * never the intent alone.
 */
const NOTE = "Backend and data work: SQL, APIs and the tests around them.";
const ORGANISATION = { role: "INSTITUTION", note: "Junior engineers who have built payments features.", organisation: "Mto Labs", organisationRole: null, link: null, scopeAcknowledged: true } as const;
const COMMUNITY: { spaces: SpaceId[] } = { spaces: ["community", "profile"] };
const MENTOR_SPACES: { spaces: SpaceId[] } = { spaces: ["community", "mentoring", "profile"] };

const setups: ReturnType<typeof onboardingDatabase>[] = [];
function setup() {
  const fixture = onboardingDatabase();
  setups.push(fixture);
  return fixture;
}
afterEach(() => setups.splice(0).forEach((fixture) => fixture.database.close()));

const state = (overrides: Partial<OnboardingState>): OnboardingState =>
  ({ stage: "DONE", intents: [], inferred: [], requests: [], roles: [], ...overrides });

describe("communityFraming", () => {
  it.each([
    ["a member", state({ intents: ["MEMBER"] }), "member"],
    ["a member who also asked to mentor", state({ intents: ["MEMBER", "MENTOR"] }), "member"],
    ["someone just looking around", state({ intents: ["EXPLORING"] }), "exploring"],
    ["a dismissed one-time card with nothing inferred keeps the framing it always had", state({ intents: [] }), "member"],
    ["a mentor only", state({ intents: ["MENTOR"] }), "partner"],
    ["an organisation only", state({ intents: ["INSTITUTION"] }), "partner"],
    ["an alumna from before onboarding (inferred)", state({ stage: "PROMPT", inferred: ["MEMBER"] }), "member"],
    ["a mentor from before onboarding (inferred from the role)", state({ stage: "PROMPT", inferred: ["MENTOR"], roles: ["MENTOR"] }), "partner"],
    ["an alumnus who mentors (inferred)", state({ stage: "PROMPT", inferred: ["MEMBER", "MENTOR"], roles: ["MENTOR"] }), "member"],
    ["an account with nothing saved or inferred keeps the framing it always had", state({ stage: "PROMPT" }), "member"],
    ["a new account that has not chosen yet", state({ stage: "NEW" }), "member"],
  ] as const)("frames %s as %s", (_name, value, framing) => {
    expect(communityFraming(value)).toBe(framing);
  });

  it("uses saved intents over inferred ones, and inferred ones only while nothing is saved", () => {
    expect(effectiveIntents(state({ intents: ["MENTOR"], inferred: ["MEMBER"] }))).toEqual(["MENTOR"]);
    expect(effectiveIntents(state({ stage: "PROMPT", inferred: ["MEMBER"] }))).toEqual(["MEMBER"]);
    expect(heldChoices(state({ intents: ["EXPLORING"] }))).toEqual([]);
    expect(heldChoices(state({ intents: ["INSTITUTION", "MEMBER"] }))).toEqual(["MEMBER", "INSTITUTION"]);
  });

  it("offers a cohort to everyone but mentors and organisations only, and to everyone while onboarding is off", () => {
    expect(offersCohort("member")).toBe(true);
    expect(offersCohort("exploring")).toBe(true);
    expect(offersCohort("partner")).toBe(false);
    expect(offersCohort(undefined)).toBe(true);
  });
});

describe("onboardingView on the service", () => {
  it("shows a pending request as Pending, lists it under Your requests, and opens no space", async () => {
    const { db } = setup();
    await saveIntents(db, "otieno", ["MENTOR"]);
    await createAccessRequest(db, "otieno", { role: "MENTOR", note: NOTE, link: null }, 1_793_500_000_000);
    const view = onboardingView(await getOnboardingState(db, "otieno"), COMMUNITY);
    expect(view.framing).toBe("partner");
    expect(view.cards).toEqual([{ kind: "pending", role: "MENTOR", id: expect.any(String), sentAt: 1_793_500_000_000 }]);
    expect(view.pending).toEqual(["MENTOR"]);
    expect(view.spaces).toEqual([]);
    expect(view.prompt).toBeNull();
  });

  it("announces an approval once, only while the role is held, and never in the space it opened", async () => {
    const { db, grant, revoke, decide } = setup();
    await saveIntents(db, "otieno", ["MENTOR"]);
    const id = await createAccessRequest(db, "otieno", { role: "MENTOR", note: NOTE, link: null });
    decide(id, "APPROVED", Date.now());
    grant("otieno", "MENTOR");
    let view = onboardingView(await getOnboardingState(db, "otieno"), MENTOR_SPACES);
    expect(view.cards).toEqual([{ kind: "approved", role: "MENTOR", id }]);
    expect(view.pending).toEqual([]);
    expect(cardsFor(view, "community")).toHaveLength(1);
    expect(cardsFor(view, "mentoring")).toEqual([]);
    // The card announces Mentoring, so "Your spaces" does not repeat it.
    expect(yourSpaces(view)).toEqual([]);

    // Role state wins: with the role removed since, nothing claims access.
    revoke("otieno", "MENTOR");
    expect(onboardingView(await getOnboardingState(db, "otieno"), COMMUNITY).cards).toEqual([]);

    // Once seen, the card stops and "Your spaces" carries the way in.
    grant("otieno", "MENTOR");
    await markAccessRequestSeen(db, "otieno", { id });
    view = onboardingView(await getOnboardingState(db, "otieno"), MENTOR_SPACES);
    expect(view.cards).toEqual([]);
    expect(yourSpaces(view)).toEqual(["MENTOR"]);
  });

  it("shows a decline with the administrator's message until dismissed, and never beside a role granted since", async () => {
    const { db, grant, decide } = setup();
    await saveIntents(db, "otieno", ["MENTOR"]);
    const id = await createAccessRequest(db, "otieno", { role: "MENTOR", note: NOTE, link: null });
    decide(id, "DECLINED", Date.now(), "Thanks for offering. <b>Not this time.</b>");
    const view = onboardingView(await getOnboardingState(db, "otieno"), COMMUNITY);
    expect(view.cards).toEqual([{ kind: "declined", role: "MENTOR", id, message: "Thanks for offering. <b>Not this time.</b>" }]);
    // A decline keeps the choice, so the person can ask again (SPEC §3).
    expect(view.state.intents).toEqual(["MENTOR"]);

    grant("otieno", "MENTOR");
    expect(onboardingView(await getOnboardingState(db, "otieno"), MENTOR_SPACES).cards).toEqual([]);
  });

  it("shows nothing for a withdrawn request, and a withdrawal leaves someone with nothing else exploring", async () => {
    const { db } = setup();
    await saveIntents(db, "otieno", ["MENTOR"]);
    const id = await createAccessRequest(db, "otieno", { role: "MENTOR", note: NOTE, link: null });
    await withdrawAccessRequest(db, "otieno", id);
    const view = onboardingView(await getOnboardingState(db, "otieno"), COMMUNITY);
    expect(view.cards).toEqual([]);
    expect(view.framing).toBe("exploring");
  });

  it("orders cards Mentor first, then Organisation", async () => {
    const { db } = setup();
    await saveIntents(db, "otieno", ["INSTITUTION", "MENTOR"]);
    await createAccessRequest(db, "otieno", ORGANISATION);
    await createAccessRequest(db, "otieno", { role: "MENTOR", note: NOTE, link: null });
    const view = onboardingView(await getOnboardingState(db, "otieno"), COMMUNITY);
    expect(view.cards.map((card) => card.role)).toEqual(["MENTOR", "INSTITUTION"]);
    expect(view.pending).toEqual(["MENTOR", "INSTITUTION"]);
  });

  it("offers the one-time card to accounts from before onboarding only, prefilled with what they suggest, until dismissed", async () => {
    const { db, database, grant } = setup();
    database.exec(`INSERT INTO programApplication(id,programId,userId,status,application) VALUES ('app','cohort-a','wairimu','COMPLETED','{}')`);
    grant("wairimu", "MENTOR");
    let view = onboardingView(await getOnboardingState(db, "wairimu"), MENTOR_SPACES);
    expect(view.prompt).toEqual({ selected: ["MEMBER", "MENTOR"], statuses: { MENTOR: "active" } });
    expect(view.framing).toBe("member");
    // An alumna who mentors still sees where Mentoring is.
    expect(yourSpaces(view)).toEqual(["MENTOR"]);

    await dismissPrompt(db, "wairimu");
    view = onboardingView(await getOnboardingState(db, "wairimu"), MENTOR_SPACES);
    expect(view.prompt).toBeNull();
    // Dismissing changes nothing they have: inference still frames them.
    expect(view.framing).toBe("member");
  });

  it("changes nothing when a community-only account dismisses the card: no welcome, no new framing", async () => {
    const { db } = setup();
    expect(communityFraming(await getOnboardingState(db, "otieno"))).toBe("member");
    await dismissPrompt(db, "otieno");
    const view = onboardingView(await getOnboardingState(db, "otieno"), COMMUNITY);
    expect(view.state.stage).toBe("DONE");
    expect(view.framing).toBe("member");
  });

  it("never offers the card to a new account, which has the welcome step instead", async () => {
    const { db } = setup();
    await startOnboarding(db, "wairimu");
    expect(onboardingView(await getOnboardingState(db, "wairimu"), COMMUNITY).prompt).toBeNull();
  });

  it("lists a granted role under Your spaces only when its space is open to the person", async () => {
    const { db, grant } = setup();
    grant("otieno", "INSTITUTION");
    const held = await getOnboardingState(db, "otieno");
    expect(onboardingView(held, COMMUNITY).spaces).toEqual([]);
    expect(onboardingView(held, { spaces: ["community", "discover", "profile"] }).spaces).toEqual(["INSTITUTION"]);
  });
});
