import { afterEach, describe, expect, it } from "vitest";
import { createAccessRequest, getOnboardingState, OnboardingError, startOnboarding } from "@/lib/onboarding/service";
import { onboardingDatabase } from "@/lib/onboarding/test-support";
import { FAILURES } from "./copy";
import { OnboardingActionError, onboardingActions } from "./server-actions";
import { handleWelcome } from "./welcome-flow";

/**
 * The welcome flow against B-O.2's real onboarding service on SQLite, the
 * way the page runs it: form posts in, redirects or steps out, and nothing
 * but intents and requests written. No role is ever granted here.
 */
const ROUTES = { choose: "/dashboard/welcome", request: "/dashboard/welcome?step=request", landing: "/dashboard" };
const NOTE = "Backend and data work: SQL, APIs and the tests around them.";

const setups: ReturnType<typeof onboardingDatabase>[] = [];
function setup() {
  const fixture = onboardingDatabase();
  setups.push(fixture);
  return fixture;
}
afterEach(() => setups.splice(0).forEach((fixture) => fixture.database.close()));

function post(path: string, fields: [string, string][]) {
  return new Request(`https://ttv.example${path}`, {
    method: "POST", body: new URLSearchParams(fields), headers: { "content-type": "application/x-www-form-urlencoded" },
  });
}

describe("the welcome flow on the onboarding service", () => {
  it("takes a new account from its choices to a Pending mentor request, granting no role", async () => {
    const { db, rows } = setup();
    await startOnboarding(db, "wairimu");
    const actions = onboardingActions(db, "wairimu");

    expect(await handleWelcome(post(ROUTES.choose, [["intent", "MEMBER"], ["intent", "MENTOR"]]), ROUTES, actions))
      .toEqual({ kind: "redirect", location: ROUTES.request });
    expect(await handleWelcome(post(ROUTES.request, [["mentorNote", NOTE], ["mentorLink", "example.org/work"]]), ROUTES, actions))
      .toEqual({ kind: "redirect", location: ROUTES.landing });

    const state = await getOnboardingState(db, "wairimu");
    expect(state).toMatchObject({ stage: "DONE", intents: ["MEMBER", "MENTOR"], roles: [] });
    expect(state.requests).toMatchObject([{ role: "MENTOR", status: "PENDING", note: NOTE, link: "https://example.org/work" }]);
    expect(rows("SELECT * FROM UserRoles WHERE userId = ?", "wairimu")).toEqual([]);
  });

  it("saves just looking around for a new account and lands", async () => {
    const { db } = setup();
    await startOnboarding(db, "otieno");
    expect(await handleWelcome(post(ROUTES.choose, [["action", "explore"]]), ROUTES, onboardingActions(db, "otieno")))
      .toEqual({ kind: "redirect", location: ROUTES.landing });
    expect(await getOnboardingState(db, "otieno")).toMatchObject({ stage: "DONE", intents: ["EXPLORING"] });
  });

  it("asks only for the access not already held", async () => {
    const { db, grant } = setup();
    grant("otieno", "MENTOR");
    const actions = onboardingActions(db, "otieno");
    await handleWelcome(post(ROUTES.choose, [["intent", "MENTOR"], ["intent", "INSTITUTION"]]), ROUTES, actions);
    const result = await handleWelcome(new Request(`https://ttv.example${ROUTES.request}`), ROUTES, actions);
    expect(result).toMatchObject({ kind: "view", view: { step: "request", roles: ["INSTITUTION"] } });
  });

  it("lands without a second request when one was sent from another tab meanwhile", async () => {
    const { db } = setup();
    const actions = onboardingActions(db, "wairimu");
    await handleWelcome(post(ROUTES.choose, [["intent", "MENTOR"]]), ROUTES, actions);
    // The other tab: the request is now pending, and this tab's request step is already on screen.
    await createAccessRequest(db, "wairimu", { role: "MENTOR", note: NOTE, link: null });
    await expect(actions.requestAccess({ role: "MENTOR", note: NOTE, link: null })).rejects.toMatchObject({ status: 409, code: "conflict" });
    expect(await handleWelcome(post(ROUTES.request, [["mentorNote", NOTE]]), ROUTES, actions))
      .toEqual({ kind: "redirect", location: ROUTES.landing });
    expect((await getOnboardingState(db, "wairimu")).requests).toHaveLength(1);
  });

  it("keeps the answers on screen once the day's requests are used up", async () => {
    const { db, decide } = setup();
    const actions = onboardingActions(db, "wairimu");
    await handleWelcome(post(ROUTES.choose, [["intent", "MENTOR"]]), ROUTES, actions);
    // Five requests today, each declined so another may be sent.
    for (let sent = 0; sent < 5; sent += 1) {
      const id = await createAccessRequest(db, "wairimu", { role: "MENTOR", note: NOTE, link: null });
      decide(id, "DECLINED", Date.now());
    }
    const result = await handleWelcome(post(ROUTES.request, [["mentorNote", NOTE]]), ROUTES, actions);
    expect(result).toMatchObject({ kind: "view", status: 429, view: { step: "request", roles: ["MENTOR"], failure: FAILURES.rateLimited } });
    if (result.kind === "view" && result.view.step === "request") expect(result.view.draft.mentorNote).toBe(NOTE);
  });

  it("carries each refusal's HTTP meaning, and lets anything else through untouched", async () => {
    const { db } = setup();
    const actions = onboardingActions(db, "wairimu");
    await actions.requestAccess({ role: "MENTOR", note: NOTE, link: null });
    const conflict = await actions.requestAccess({ role: "MENTOR", note: NOTE, link: null }).catch((error: unknown) => error);
    expect(conflict).toBeInstanceOf(OnboardingActionError);
    expect(conflict).not.toBeInstanceOf(OnboardingError);
    const invalid = await actions.saveIntents(["EXPLORING", "MEMBER"]).catch((error: unknown) => error);
    expect(invalid).not.toBeInstanceOf(OnboardingActionError);
  });
});
