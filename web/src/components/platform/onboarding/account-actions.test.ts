import { afterEach, describe, expect, it, vi } from "vitest";
import { createAccessRequest, getOnboardingState, saveIntents } from "@/lib/onboarding/service";
import { onboardingDatabase } from "@/lib/onboarding/test-support";
import { ACCOUNT_PATH, handleAccountAction, returnPath, type AccountActions } from "./account-actions";
import { OnboardingActionError, accountActions } from "./server-actions";

/**
 * The onboarding forms on the landing pages and Account (S3 Dismiss, S4, S5),
 * on B-O.2's real service. Every post answers with a redirect back to a page
 * on a fixed list, and none of them writes a role.
 */
const NOTE = "Backend and data work: SQL, APIs and the tests around them.";
const ACCOUNT = `${ACCOUNT_PATH}#taking-part`;

const setups: ReturnType<typeof onboardingDatabase>[] = [];
function setup() {
  const fixture = onboardingDatabase();
  setups.push(fixture);
  return fixture;
}
afterEach(() => setups.splice(0).forEach((fixture) => fixture.database.close()));

function form(fields: Record<string, string | string[]>): FormData {
  const data = new FormData();
  for (const [name, value] of Object.entries(fields)) for (const item of [value].flat()) data.append(name, item);
  return data;
}

function alumna() {
  const fixture = setup();
  fixture.database.exec(`INSERT INTO programApplication(id,programId,userId,status,application) VALUES ('app','cohort-a','wairimu','COMPLETED','{}')`);
  return { ...fixture, actions: accountActions(fixture.db, "wairimu") };
}

describe("returnPath", () => {
  it("returns to the landing page the form came from, and to Account's section otherwise", () => {
    expect(returnPath("/dashboard/cohort")).toBe("/dashboard/cohort");
    expect(returnPath("/dashboard/community")).toBe("/dashboard/community");
    expect(returnPath("/dashboard/mentoring")).toBe("/dashboard/mentoring");
    expect(returnPath("/dashboard/discover")).toBe("/dashboard/discover");
    expect(returnPath("/dashboard/account")).toBe(ACCOUNT);
    for (const hostile of ["https://evil.example/", "//evil.example/dashboard/cohort", "/dashboard/cohort?x=1", "/admin", "", null]) {
      expect(returnPath(hostile)).toBe(ACCOUNT);
    }
  });
});

describe("the one-time card (S4)", () => {
  it("Not now hides it for good and changes nothing the person has", async () => {
    const { db, rows, actions } = alumna();
    expect((await getOnboardingState(db, "wairimu")).stage).toBe("PROMPT");
    expect(await handleAccountAction(form({ onboarding: "dismiss-prompt", return: "/dashboard/cohort" }), actions))
      .toEqual({ kind: "redirect", location: "/dashboard/cohort" });
    const state = await getOnboardingState(db, "wairimu");
    expect(state).toMatchObject({ stage: "DONE", intents: [], inferred: ["MEMBER"] });
    expect(rows("SELECT * FROM member_intent WHERE userId = ?", "wairimu")).toEqual([]);
    // Pressed twice (a second tab), it is still gone and still nothing changed.
    await handleAccountAction(form({ onboarding: "dismiss-prompt", return: "/dashboard/cohort" }), actions);
    expect((await getOnboardingState(db, "wairimu")).stage).toBe("DONE");
  });

  it("Save records the choices and returns, or goes on to the request step for access not held", async () => {
    const { db, rows, actions } = alumna();
    expect(await handleAccountAction(form({ onboarding: "save-prompt", intent: ["MEMBER"], return: "/dashboard/cohort" }), actions))
      .toEqual({ kind: "redirect", location: "/dashboard/cohort" });
    expect(await getOnboardingState(db, "wairimu")).toMatchObject({ stage: "DONE", intents: ["MEMBER"] });

    expect(await handleAccountAction(form({ onboarding: "save-prompt", intent: ["MEMBER", "MENTOR"], return: "/dashboard/cohort" }), actions))
      .toEqual({ kind: "redirect", location: "/dashboard/welcome?step=request" });
    expect((await getOnboardingState(db, "wairimu")).intents).toEqual(["MEMBER", "MENTOR"]);
    // Choosing asks; it grants nothing.
    expect(rows("SELECT * FROM UserRoles WHERE userId = ?", "wairimu")).toEqual([]);
    expect(rows("SELECT * FROM access_request WHERE userId = ?", "wairimu")).toEqual([]);
  });

  it("Save with nothing ticked opens the welcome step, which asks properly", async () => {
    const { db, actions } = alumna();
    expect(await handleAccountAction(form({ onboarding: "save-prompt", intent: ["EXPLORING", "ADMIN"], return: "/dashboard/cohort" }), actions))
      .toEqual({ kind: "redirect", location: "/dashboard/welcome" });
    expect((await getOnboardingState(db, "wairimu")).stage).toBe("PROMPT");
  });

  it("does not offer the request step for access already held", async () => {
    const { db, grant, actions } = alumna();
    grant("wairimu", "MENTOR");
    expect(await handleAccountAction(form({ onboarding: "save-prompt", intent: ["MEMBER", "MENTOR"], return: "/dashboard/mentoring" }), actions))
      .toEqual({ kind: "redirect", location: "/dashboard/mentoring" });
    expect((await getOnboardingState(db, "wairimu")).intents).toEqual(["MEMBER", "MENTOR"]);
  });
});

describe("Account → How you take part (S5)", () => {
  it("switches Build and learn on and off, starting from what was inferred, and off to exploring", async () => {
    const { db, actions } = alumna();
    expect(await handleAccountAction(form({ onboarding: "member", value: "off", return: ACCOUNT_PATH }), actions))
      .toEqual({ kind: "redirect", location: ACCOUNT });
    expect((await getOnboardingState(db, "wairimu")).intents).toEqual(["EXPLORING"]);
    await handleAccountAction(form({ onboarding: "member", value: "on", return: ACCOUNT_PATH }), actions);
    expect((await getOnboardingState(db, "wairimu")).intents).toEqual(["MEMBER"]);
  });

  it("keeps the other choices when switching", async () => {
    const { db, actions } = alumna();
    await saveIntents(db, "wairimu", ["MEMBER", "INSTITUTION"]);
    await handleAccountAction(form({ onboarding: "member", value: "off", return: ACCOUNT_PATH }), actions);
    expect((await getOnboardingState(db, "wairimu")).intents).toEqual(["INSTITUTION"]);
  });

  it("Request access records the choice and asks about that access only", async () => {
    const { db, decide, actions } = alumna();
    await saveIntents(db, "wairimu", ["MEMBER", "MENTOR"]);
    const declined = await createAccessRequest(db, "wairimu", { role: "MENTOR", note: NOTE, link: null });
    decide(declined, "DECLINED", Date.now());
    // The old mentor decline is askable again, but this asks about organisation access alone.
    expect(await handleAccountAction(form({ onboarding: "request", role: "INSTITUTION", return: ACCOUNT_PATH }), actions))
      .toEqual({ kind: "redirect", location: "/dashboard/welcome?step=request&role=institution" });
    expect((await getOnboardingState(db, "wairimu")).intents).toEqual(["MEMBER", "MENTOR", "INSTITUTION"]);
    // Send a new request, after a decline.
    expect(await handleAccountAction(form({ onboarding: "request", role: "MENTOR", return: "/dashboard/community" }), actions))
      .toEqual({ kind: "redirect", location: "/dashboard/welcome?step=request&role=mentor" });
  });

  it("Request access while a request waits, or for access held, just returns", async () => {
    const { db, grant, actions } = alumna();
    await saveIntents(db, "wairimu", ["MENTOR"]);
    await createAccessRequest(db, "wairimu", { role: "MENTOR", note: NOTE, link: null });
    expect(await handleAccountAction(form({ onboarding: "request", role: "MENTOR", return: ACCOUNT_PATH }), actions))
      .toEqual({ kind: "redirect", location: ACCOUNT });
    grant("wairimu", "INSTITUTION");
    expect(await handleAccountAction(form({ onboarding: "request", role: "INSTITUTION", return: ACCOUNT_PATH }), actions))
      .toEqual({ kind: "redirect", location: ACCOUNT });
  });

  it("withdraws a pending request, which removes its choice, and a replay returns quietly", async () => {
    const { db, actions } = alumna();
    await saveIntents(db, "wairimu", ["MEMBER", "MENTOR"]);
    const id = await createAccessRequest(db, "wairimu", { role: "MENTOR", note: NOTE, link: null });
    const withdraw = form({ onboarding: "withdraw", id, return: ACCOUNT_PATH });
    expect(await handleAccountAction(withdraw, actions)).toEqual({ kind: "redirect", location: ACCOUNT });
    const state = await getOnboardingState(db, "wairimu");
    expect(state.intents).toEqual(["MEMBER"]);
    expect(state.requests).toMatchObject([{ role: "MENTOR", status: "WITHDRAWN" }]);
    // No longer pending (409): the page shows what is true now.
    expect(await handleAccountAction(withdraw, actions)).toEqual({ kind: "redirect", location: ACCOUNT });
  });

  it("cannot withdraw or dismiss someone else's request", async () => {
    const { db, rows, decide, actions } = alumna();
    await saveIntents(db, "otieno", ["MENTOR"]);
    const theirs = await createAccessRequest(db, "otieno", { role: "MENTOR", note: NOTE, link: null });
    expect(await handleAccountAction(form({ onboarding: "withdraw", id: theirs, return: ACCOUNT_PATH }), actions))
      .toEqual({ kind: "redirect", location: ACCOUNT });
    decide(theirs, "DECLINED", Date.now());
    expect(await handleAccountAction(form({ onboarding: "dismiss", id: theirs, return: "/dashboard/community" }), actions))
      .toEqual({ kind: "redirect", location: "/dashboard/community" });
    expect(rows("SELECT status, requesterSeenAt FROM access_request WHERE id = ?", theirs)).toEqual([{ status: "DECLINED", requesterSeenAt: null }]);
  });

  it("Remove takes away a declined choice, but never a pending one, which is withdrawn instead", async () => {
    const { db, decide, actions } = alumna();
    await saveIntents(db, "wairimu", ["MEMBER", "MENTOR", "INSTITUTION"]);
    const mentor = await createAccessRequest(db, "wairimu", { role: "MENTOR", note: NOTE, link: null });
    decide(mentor, "DECLINED", Date.now());
    await createAccessRequest(db, "wairimu", {
      role: "INSTITUTION", note: NOTE, organisation: "Mto Labs", organisationRole: null, link: null, scopeAcknowledged: true,
    });
    await handleAccountAction(form({ onboarding: "remove", role: "INSTITUTION", return: ACCOUNT_PATH }), actions);
    expect((await getOnboardingState(db, "wairimu")).intents).toEqual(["MEMBER", "MENTOR", "INSTITUTION"]);
    await handleAccountAction(form({ onboarding: "remove", role: "MENTOR", return: ACCOUNT_PATH }), actions);
    expect((await getOnboardingState(db, "wairimu")).intents).toEqual(["MEMBER", "INSTITUTION"]);
  });
});

describe("a status card's Dismiss (S3)", () => {
  it("marks a decision seen, so its card stops", async () => {
    const { db, decide, actions } = alumna();
    await saveIntents(db, "wairimu", ["MENTOR"]);
    const id = await createAccessRequest(db, "wairimu", { role: "MENTOR", note: NOTE, link: null });
    decide(id, "DECLINED", Date.now(), "Not this time.");
    expect(await handleAccountAction(form({ onboarding: "dismiss", id, return: "/dashboard/community" }), actions))
      .toEqual({ kind: "redirect", location: "/dashboard/community" });
    expect((await getOnboardingState(db, "wairimu")).requests[0]!.seenAt).toEqual(expect.any(Number));
  });
});

describe("refusals and failures", () => {
  const actions = (): AccountActions => ({
    load: vi.fn().mockResolvedValue({ stage: "DONE", intents: ["MEMBER"], inferred: [], requests: [], roles: [] }),
    saveIntents: vi.fn().mockRejectedValue(new Error("D1 unavailable")),
    dismissPrompt: vi.fn().mockRejectedValue(new Error("D1 unavailable")),
    withdraw: vi.fn().mockRejectedValue(new OnboardingActionError(409, "conflict", "Only pending requests can do that.")),
    dismissRequest: vi.fn().mockRejectedValue(new OnboardingActionError(404, "not_found", "Request not found.")),
  });

  it("refuses a form that is not one of these, or is missing what it needs", async () => {
    const refused: Record<string, string>[] = [{}, { onboarding: "grant" }, { onboarding: "request", role: "ADMIN" }, { onboarding: "withdraw" },
      { onboarding: "member", value: "maybe" }, { onboarding: "remove" }, { onboarding: "dismiss", id: "x".repeat(256) }];
    for (const fields of refused) {
      expect.soft(await handleAccountAction(form(fields), actions())).toEqual({ kind: "refuse", status: 400 });
    }
  });

  it("returns with a note when a write fails, keeping the section in view", async () => {
    expect(await handleAccountAction(form({ onboarding: "member", value: "off", return: ACCOUNT_PATH }), actions()))
      .toEqual({ kind: "redirect", location: "/dashboard/account?onboarding=unsaved#taking-part" });
    expect(await handleAccountAction(form({ onboarding: "dismiss-prompt", return: "/dashboard/cohort" }), actions()))
      .toEqual({ kind: "redirect", location: "/dashboard/cohort?onboarding=unsaved" });
  });

  it("returns quietly when the request moved on: the page shows what is true now", async () => {
    expect(await handleAccountAction(form({ onboarding: "withdraw", id: "r1", return: ACCOUNT_PATH }), actions()))
      .toEqual({ kind: "redirect", location: ACCOUNT });
    expect(await handleAccountAction(form({ onboarding: "dismiss", id: "r1", return: "/dashboard/discover" }), actions()))
      .toEqual({ kind: "redirect", location: "/dashboard/discover" });
  });
});
