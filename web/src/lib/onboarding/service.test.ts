import { afterEach, describe, expect, it, vi } from "vitest";
import { ZodError } from "zod";
import { OnboardingState, type CreateAccessRequest, type OnboardingState as State } from "@/lib/platform/contracts";
import {
  ACCESS_REQUEST_DAILY_LIMIT, OnboardingError, createAccessRequest, dismissPrompt, getOnboardingState,
  markAccessRequestSeen, saveIntents, startOnboarding, unseenApprovals, withdrawAccessRequest,
} from "./service";
import { onboardingDatabase } from "./test-support";

const DAY = 24 * 60 * 60 * 1000;
const T = Date.parse("2026-11-01T08:00:00Z");
const mentor: CreateAccessRequest = { role: "MENTOR", note: "I review mobile apps and API designs for junior developers.", link: null };
const institution: CreateAccessRequest = {
  role: "INSTITUTION", note: "We want to find junior mobile developers for paid internships.",
  organisation: "Savanna Mobile Labs", organisationRole: "Engineering lead", link: "https://example.com/savanna", scopeAcknowledged: true,
};

const setups: ReturnType<typeof onboardingDatabase>[] = [];
function setup() {
  const fixture = onboardingDatabase();
  setups.push(fixture);
  return fixture;
}
afterEach(() => { setups.splice(0).forEach(fixture => fixture.database.close()); vi.restoreAllMocks(); });

async function rejection(promise: Promise<unknown>) {
  const error = await promise.then(() => null, (reason: unknown) => reason);
  expect(error).toBeInstanceOf(OnboardingError);
  return error as OnboardingError;
}

describe("getOnboardingState", () => {
  it("treats an account without a row as one from before rollout, in two reads", async () => {
    const { db } = setup();
    const prepare = vi.spyOn(db, "prepare");
    const state = await getOnboardingState(db, "wairimu");
    expect(state).toEqual({ stage: "PROMPT", intents: [], inferred: [], requests: [], roles: [] });
    expect(OnboardingState.parse(state)).toEqual(state);
    expect(prepare).toHaveBeenCalledTimes(2);
  });

  it.each([
    ["an application", "INSERT INTO programApplication(id,userId,programId,status,application) VALUES ('a','wairimu','cohort-a','PENDING','{}')", ["MEMBER"]],
    ["a student profile", "INSERT INTO studentProfile(id,userId,handle) VALUES ('p','wairimu','wairimu')", ["MEMBER"]],
    ...(["MENTOR", "TA", "INSTRUCTOR"] as const).map((name) => [`a cohort ${name} assignment alone`,
      `INSERT INTO programRole(id,userId,programId,name) VALUES ('r','wairimu','cohort-a','${name}')`, []] as const),
    ["a community profile alone", "INSERT INTO communityProfile(userId) VALUES ('wairimu')", []],
    ["a journey alone", "INSERT INTO communityJourney(id,userId,title,description,occurredAt,visibility) VALUES ('j','wairimu','Built','A thing','2026-10','private')", []],
    ["the MENTOR role", "INSERT INTO UserRoles(id,userId,roleId) SELECT 'ur','wairimu',id FROM Roles WHERE name='MENTOR'", ["MENTOR"]],
    ["the INSTITUTION role", "INSERT INTO UserRoles(id,userId,roleId) SELECT 'ur','wairimu',id FROM Roles WHERE name='INSTITUTION'", ["INSTITUTION"]],
    ["the ADMIN role", "INSERT INTO UserRoles(id,userId,roleId) SELECT 'ur','wairimu',id FROM Roles WHERE name='ADMIN'", []],
    ["another person's footprint", "INSERT INTO studentProfile(id,userId,handle) VALUES ('p','otieno','otieno')", []],
  ] as const)("infers intents from %s", async (_name, sql, inferred) => {
    const { db, database } = setup();
    database.exec(sql);
    expect((await getOnboardingState(db, "wairimu")).inferred).toEqual(inferred);
  });

  it("infers every footprint at once, in intent order, and lists held access roles", async () => {
    const { db, database, grant } = setup();
    grant("wairimu", "INSTITUTION");
    grant("wairimu", "MENTOR");
    grant("wairimu", "ADMIN");
    database.exec("INSERT INTO studentProfile(id,userId,handle) VALUES ('p','wairimu','wairimu')");
    expect(await getOnboardingState(db, "wairimu")).toMatchObject({
      inferred: ["MEMBER", "MENTOR", "INSTITUTION"], roles: ["MENTOR", "INSTITUTION"],
    });
  });

  it("stops inferring once anything is saved, but keeps inferring after the card is dismissed", async () => {
    const { db, grant } = setup();
    grant("wairimu", "MENTOR");
    await dismissPrompt(db, "wairimu", T);
    expect(await getOnboardingState(db, "wairimu")).toMatchObject({ stage: "DONE", intents: [], inferred: ["MENTOR"] });
    await saveIntents(db, "wairimu", ["MEMBER"], T);
    expect(await getOnboardingState(db, "wairimu")).toMatchObject({ intents: ["MEMBER"], inferred: [] });
  });

  it("lists only the latest request per role, without who decided", async () => {
    const { db, decide } = setup();
    const declined = await createAccessRequest(db, "wairimu", mentor, T);
    decide(declined, "DECLINED", T + 1, "Thank you. We have enough mentors for this cohort.");
    const again = await createAccessRequest(db, "wairimu", mentor, T + 2);
    const organisation = await createAccessRequest(db, "wairimu", institution, T + 3);
    const state = await getOnboardingState(db, "wairimu");
    expect(state.requests.map(request => [request.id, request.role, request.status])).toEqual([
      [again, "MENTOR", "PENDING"], [organisation, "INSTITUTION", "PENDING"],
    ]);
    expect(state.requests[1]).toEqual({
      id: organisation, role: "INSTITUTION", status: "PENDING", note: institution.note, organisation: "Savanna Mobile Labs",
      organisationRole: "Engineering lead", link: "https://example.com/savanna", decisionMessage: null,
      createdAt: T + 3, updatedAt: T + 3, decidedAt: null, seenAt: null,
    });
    decide(again, "APPROVED", T + 4);
    const decided = await getOnboardingState(db, "wairimu");
    expect(decided.requests[0]).toMatchObject({ id: again, status: "APPROVED", decidedAt: T + 4 });
    expect(JSON.stringify(decided)).not.toMatch(/amina|decidedBy|decisionId/);
  });

  it("breaks createdAt ties by insertion order", async () => {
    const { db, decide } = setup();
    const first = await createAccessRequest(db, "wairimu", mentor, T);
    decide(first, "DECLINED", T);
    const second = await createAccessRequest(db, "wairimu", mentor, T);
    expect((await getOnboardingState(db, "wairimu")).requests.map(request => request.id)).toEqual([second]);
  });

  it("keeps request text exactly as written; rendering escapes it", async () => {
    const { db } = setup();
    const note = "<img src=x onerror=alert(1)> I review mobile apps.";
    await createAccessRequest(db, "wairimu", { ...mentor, note }, T);
    expect((await getOnboardingState(db, "wairimu")).requests[0].note).toBe(note);
  });

  it("hides a request left pending beside the role it asks for, since role state wins", async () => {
    const { db, grant } = setup();
    await createAccessRequest(db, "wairimu", mentor, T);
    grant("wairimu", "MENTOR");
    const state = await getOnboardingState(db, "wairimu");
    expect(state).toMatchObject({ roles: ["MENTOR"], requests: [] });
    expect(OnboardingState.parse(state)).toEqual(state);
  });

  it("never reads another person's onboarding", async () => {
    const { db } = setup();
    await startOnboarding(db, "otieno", T);
    await saveIntents(db, "otieno", ["MENTOR"], T);
    await createAccessRequest(db, "otieno", mentor, T);
    expect(await getOnboardingState(db, "wairimu")).toEqual({ stage: "PROMPT", intents: [], inferred: [], requests: [], roles: [] });
  });
});

describe("unseenApprovals", () => {
  const approved = (role: "MENTOR" | "INSTITUTION", seenAt: number | null) => ({
    id: role, role, status: "APPROVED" as const, note: mentor.note, organisation: role === "INSTITUTION" ? "Savanna" : null,
    organisationRole: null, link: null, decisionMessage: null, createdAt: T, updatedAt: T, decidedAt: T, seenAt,
  });
  const withRequests = (requests: State["requests"], roles: State["roles"]): State =>
    ({ stage: "DONE", intents: [], inferred: [], requests, roles });

  it.each([
    { name: "a held, unseen approval", requests: [approved("MENTOR", null)], roles: ["MENTOR"], expected: ["MENTOR"] },
    { name: "both, in preference order", requests: [approved("MENTOR", null), approved("INSTITUTION", null)], roles: ["MENTOR", "INSTITUTION"], expected: ["MENTOR", "INSTITUTION"] },
    { name: "a seen approval", requests: [approved("MENTOR", T)], roles: ["MENTOR"], expected: [] },
    { name: "an approval whose role was removed", requests: [approved("MENTOR", null)], roles: [], expected: [] },
    { name: "no requests", requests: [], roles: ["MENTOR"], expected: [] },
  ] as const)("$name", ({ requests, roles, expected }) => {
    expect(unseenApprovals(withRequests([...requests], [...roles]))).toEqual(expected);
  });

  it("reads a real approval until it is seen", async () => {
    const { db, grant, decide } = setup();
    const id = await createAccessRequest(db, "wairimu", institution, T);
    decide(id, "APPROVED", T + 1);
    grant("wairimu", "INSTITUTION");
    expect(unseenApprovals(await getOnboardingState(db, "wairimu"))).toEqual(["INSTITUTION"]);
    await markAccessRequestSeen(db, "wairimu", { role: "INSTITUTION" }, T + 2);
    expect(unseenApprovals(await getOnboardingState(db, "wairimu"))).toEqual([]);
  });

  it("drops an unseen approval once an administrator removes the role", async () => {
    const { db, grant, revoke, decide } = setup();
    const id = await createAccessRequest(db, "wairimu", mentor, T);
    decide(id, "APPROVED", T + 1);
    grant("wairimu", "MENTOR");
    revoke("wairimu", "MENTOR");
    const state = await getOnboardingState(db, "wairimu");
    expect(state).toMatchObject({ roles: [], requests: [{ status: "APPROVED", seenAt: null }] });
    expect(unseenApprovals(state)).toEqual([]);
  });
});

describe("startOnboarding", () => {
  it("marks a new account NEW once and never resets a finished onboarding", async () => {
    const { db, rows } = setup();
    await startOnboarding(db, "wairimu", T);
    await startOnboarding(db, "wairimu", T + 1);
    expect((await getOnboardingState(db, "wairimu")).stage).toBe("NEW");
    expect(rows("SELECT * FROM member_onboarding")).toEqual([
      { userId: "wairimu", stage: "NEW", completedAt: null, promptDismissedAt: null, createdAt: T, updatedAt: T },
    ]);
    await saveIntents(db, "wairimu", ["MEMBER"], T + 2);
    await startOnboarding(db, "wairimu", T + 3);
    expect((await getOnboardingState(db, "wairimu")).stage).toBe("DONE");
  });
});

describe("saveIntents", () => {
  it("completes onboarding and replaces the set, keeping when each kept intent was first chosen", async () => {
    const { db, rows } = setup();
    await startOnboarding(db, "wairimu", T);
    await saveIntents(db, "wairimu", ["MENTOR", "MEMBER"], T + 1);
    expect(await getOnboardingState(db, "wairimu")).toMatchObject({ stage: "DONE", intents: ["MEMBER", "MENTOR"] });
    await saveIntents(db, "wairimu", ["MEMBER", "INSTITUTION"], T + 2);
    expect(rows("SELECT intent, createdAt FROM member_intent ORDER BY intent")).toEqual([
      { intent: "INSTITUTION", createdAt: T + 2 }, { intent: "MEMBER", createdAt: T + 1 },
    ]);
    expect(rows("SELECT stage, completedAt, createdAt, updatedAt FROM member_onboarding")).toEqual([
      { stage: "DONE", completedAt: T + 1, createdAt: T, updatedAt: T + 2 },
    ]);
  });

  it("completes onboarding for an account from before rollout", async () => {
    const { db } = setup();
    await saveIntents(db, "wairimu", ["EXPLORING"], T);
    expect(await getOnboardingState(db, "wairimu")).toMatchObject({ stage: "DONE", intents: ["EXPLORING"], inferred: [] });
  });

  it("stores an empty choice as exploring, so it never reads as 'never chose'", async () => {
    const { db, database } = setup();
    database.exec("INSERT INTO studentProfile(id,userId,handle) VALUES ('p','wairimu','wairimu')");
    await saveIntents(db, "wairimu", ["MEMBER"], T);
    await saveIntents(db, "wairimu", [], T + 1);
    expect(await getOnboardingState(db, "wairimu")).toMatchObject({ intents: ["EXPLORING"], inferred: [] });
  });

  it.each([
    [["EXPLORING", "MEMBER"]], [["MEMBER", "MEMBER"]], [["ADMIN"]], [["MEMBER", "MENTOR", "INSTITUTION", "EXPLORING", "MEMBER"]],
  ])("rejects %j without writing", async intents => {
    const { db, rows } = setup();
    await expect(saveIntents(db, "wairimu", intents as never, T)).rejects.toBeInstanceOf(ZodError);
    expect(rows("SELECT * FROM member_intent")).toEqual([]);
    expect(rows("SELECT * FROM member_onboarding")).toEqual([]);
  });

  it("never touches roles: choosing mentor or institution grants nothing", async () => {
    const { db, rows } = setup();
    const roles = () => rows("SELECT * FROM UserRoles ORDER BY id");
    const before = roles();
    await saveIntents(db, "wairimu", ["MEMBER", "MENTOR", "INSTITUTION"], T);
    expect(roles()).toEqual(before);
    expect((await getOnboardingState(db, "wairimu")).roles).toEqual([]);
  });

  it("leaves another person's intents alone", async () => {
    const { db, rows } = setup();
    await saveIntents(db, "otieno", ["MENTOR"], T);
    await saveIntents(db, "wairimu", ["MEMBER"], T);
    expect(rows("SELECT userId, intent FROM member_intent ORDER BY userId")).toEqual([
      { userId: "otieno", intent: "MENTOR" }, { userId: "wairimu", intent: "MEMBER" },
    ]);
  });
});

describe("dismissPrompt", () => {
  it("finishes the card once, keeping the first dismissal and anything already saved", async () => {
    const { db, rows } = setup();
    await dismissPrompt(db, "wairimu", T);
    await dismissPrompt(db, "wairimu", T + 1);
    expect(rows("SELECT * FROM member_onboarding")).toEqual([
      { userId: "wairimu", stage: "DONE", completedAt: null, promptDismissedAt: T, createdAt: T, updatedAt: T + 1 },
    ]);
    expect((await getOnboardingState(db, "wairimu")).stage).toBe("DONE");
  });

  it("also lets a NEW account step past the welcome step", async () => {
    const { db } = setup();
    await startOnboarding(db, "wairimu", T);
    await dismissPrompt(db, "wairimu", T + 1);
    expect(await getOnboardingState(db, "wairimu")).toMatchObject({ stage: "DONE", intents: [] });
  });
});

describe("createAccessRequest", () => {
  it("records a pending mentor request and the matching intent, replacing exploring", async () => {
    const { db, rows } = setup();
    await saveIntents(db, "wairimu", ["EXPLORING"], T);
    const id = await createAccessRequest(db, "wairimu", { ...mentor, link: "https://example.com/wairimu" }, T + 1);
    expect(await getOnboardingState(db, "wairimu")).toEqual({
      stage: "DONE", intents: ["MENTOR"], inferred: [], roles: [],
      requests: [{ id, role: "MENTOR", status: "PENDING", note: mentor.note, organisation: null, organisationRole: null,
        link: "https://example.com/wairimu", decisionMessage: null, createdAt: T + 1, updatedAt: T + 1, decidedAt: null, seenAt: null }],
    });
    expect(rows("SELECT scopeAcknowledgedAt, decidedBy, decisionId FROM access_request")).toEqual([
      { scopeAcknowledgedAt: null, decidedBy: null, decisionId: null },
    ]);
  });

  it("records when an organisation acknowledged the scope of approval", async () => {
    const { db, rows } = setup();
    await saveIntents(db, "wairimu", ["MEMBER"], T);
    await createAccessRequest(db, "wairimu", institution, T + 1);
    expect(rows("SELECT role, organisation, scopeAcknowledgedAt FROM access_request")).toEqual([
      { role: "INSTITUTION", organisation: "Savanna Mobile Labs", scopeAcknowledgedAt: T + 1 },
    ]);
    expect((await getOnboardingState(db, "wairimu")).intents).toEqual(["MEMBER", "INSTITUTION"]);
  });

  it.each([
    { name: "an application", sql: "INSERT INTO programApplication(id,userId,programId,status,application) VALUES ('a','wairimu','cohort-a','COMPLETED','{}')", role: null, expected: ["MEMBER", "MENTOR"] },
    { name: "the INSTITUTION role", sql: null, role: "INSTITUTION", expected: ["MENTOR", "INSTITUTION"] },
    { name: "nothing to infer", sql: null, role: null, expected: ["MENTOR"] },
  ] as const)("saves what was inferred from $name before the first request", async ({ sql, role, expected }) => {
    const { db, database, grant } = setup();
    if (sql) database.exec(sql);
    if (role) grant("wairimu", role);
    await createAccessRequest(db, "wairimu", mentor, T);
    expect((await getOnboardingState(db, "wairimu")).intents).toEqual(expected);
  });

  it("never re-infers over a saved choice, nor when the request is refused", async () => {
    const { db, database, grant, rows } = setup();
    database.exec("INSERT INTO studentProfile(id,userId,handle) VALUES ('p','wairimu','wairimu')");
    await saveIntents(db, "wairimu", ["EXPLORING"], T);
    await createAccessRequest(db, "wairimu", mentor, T + 1);
    expect((await getOnboardingState(db, "wairimu")).intents).toEqual(["MENTOR"]);
    database.exec("DELETE FROM member_intent");
    grant("wairimu", "INSTITUTION");
    await rejection(createAccessRequest(db, "wairimu", institution, T + 2));
    expect(rows("SELECT * FROM member_intent")).toEqual([]);
  });

  it("refuses a second pending request for the same role, but not for the other role", async () => {
    const { db, rows } = setup();
    await createAccessRequest(db, "wairimu", mentor, T);
    const error = await rejection(createAccessRequest(db, "wairimu", mentor, T + 1));
    expect(error.code).toBe("conflict");
    await createAccessRequest(db, "wairimu", institution, T + 2);
    expect(rows("SELECT role FROM access_request ORDER BY createdAt")).toEqual([{ role: "MENTOR" }, { role: "INSTITUTION" }]);
  });

  it("lets only one of two concurrent requests through", async () => {
    const { db, rows } = setup();
    const results = await Promise.allSettled([createAccessRequest(db, "wairimu", mentor, T), createAccessRequest(db, "wairimu", mentor, T)]);
    expect(results.map(result => result.status).toSorted()).toEqual(["fulfilled", "rejected"]);
    expect(rows("SELECT count(*) AS n FROM access_request")).toEqual([{ n: 1 }]);
  });

  it("refuses a role the person already holds, without recording the intent", async () => {
    const { db, grant, rows } = setup();
    grant("wairimu", "INSTITUTION");
    const error = await rejection(createAccessRequest(db, "wairimu", institution, T));
    expect(error.code).toBe("conflict");
    expect(rows("SELECT * FROM access_request")).toEqual([]);
    expect(rows("SELECT * FROM member_intent")).toEqual([]);
  });

  it("allows a new request after a decline or a withdrawal", async () => {
    const { db, decide } = setup();
    const declined = await createAccessRequest(db, "wairimu", mentor, T);
    decide(declined, "DECLINED", T + 1);
    const withdrawn = await createAccessRequest(db, "wairimu", mentor, T + 2);
    await withdrawAccessRequest(db, "wairimu", withdrawn, T + 3);
    const latest = await createAccessRequest(db, "wairimu", mentor, T + 4);
    expect((await getOnboardingState(db, "wairimu")).requests).toMatchObject([{ id: latest, status: "PENDING" }]);
  });

  it(`allows ${ACCESS_REQUEST_DAILY_LIMIT} creations in 24 hours, then says when the next one is possible`, async () => {
    const { db, rows } = setup();
    for (let i = 0; i < ACCESS_REQUEST_DAILY_LIMIT; i += 1) {
      const id = await createAccessRequest(db, "wairimu", mentor, T + i * 1_000);
      await withdrawAccessRequest(db, "wairimu", id, T + i * 1_000 + 1);
    }
    await createAccessRequest(db, "otieno", mentor, T + 10_000);
    const error = await rejection(createAccessRequest(db, "wairimu", institution, T + 10_000));
    expect(error).toMatchObject({ code: "rate_limited", retryAfterMs: DAY - 10_000 });
    expect(rows("SELECT count(*) AS n FROM access_request WHERE userId='wairimu'")).toEqual([{ n: ACCESS_REQUEST_DAILY_LIMIT }]);
    expect((await rejection(createAccessRequest(db, "wairimu", mentor, T + DAY - 1))).code).toBe("rate_limited");
    await createAccessRequest(db, "wairimu", mentor, T + DAY);
  });

  it("asks for a plain retry when neither refusal reason holds by the time it looks", async () => {
    const { db } = setup();
    // The insert saw a held role that was removed before the follow-up read.
    vi.spyOn(db, "batch").mockResolvedValueOnce([{ meta: { changes: 0 } }, { meta: { changes: 0 } }, { meta: { changes: 0 } }] as D1Result[]);
    const error = await rejection(createAccessRequest(db, "wairimu", mentor, T));
    expect(error).toMatchObject({ code: "conflict", retryAfterMs: undefined });
    await createAccessRequest(db, "wairimu", mentor, T + 1);
  });

  it("rejects malformed input before writing", async () => {
    const { db, rows } = setup();
    for (const input of [
      { ...mentor, note: "Too short" },
      { ...mentor, link: "https://ttv.example@other.example" },
      { ...mentor, link: "ftp://example.com/wairimu" },
      { ...institution, scopeAcknowledged: false },
      { ...mentor, organisation: "Smuggled" },
      { role: "ADMIN", note: mentor.note, link: null },
    ]) await expect(createAccessRequest(db, "wairimu", input as CreateAccessRequest, T)).rejects.toBeInstanceOf(ZodError);
    expect(rows("SELECT * FROM access_request")).toEqual([]);
  });

  it("never grants a role", async () => {
    const { db, rows } = setup();
    await createAccessRequest(db, "wairimu", mentor, T);
    await createAccessRequest(db, "wairimu", institution, T);
    expect(rows("SELECT * FROM UserRoles")).toEqual([]);
  });
});

describe("withdrawAccessRequest", () => {
  it("withdraws the owner's pending request and removes its intent", async () => {
    const { db, rows } = setup();
    await saveIntents(db, "wairimu", ["MEMBER", "MENTOR"], T);
    const id = await createAccessRequest(db, "wairimu", mentor, T + 1);
    await withdrawAccessRequest(db, "wairimu", id, T + 2);
    const state = await getOnboardingState(db, "wairimu");
    expect(state).toMatchObject({
      intents: ["MEMBER"], requests: [{ id, status: "WITHDRAWN", updatedAt: T + 2, decidedAt: null }],
    });
    expect(rows("SELECT withdrawalId, decisionId FROM access_request")).toEqual([{ withdrawalId: expect.any(String), decisionId: null }]);
    expect(JSON.stringify(state)).not.toContain("withdrawalId");
  });

  it("leaves a completed onboarding exploring when it removes the last intent", async () => {
    const { db } = setup();
    await saveIntents(db, "wairimu", ["MENTOR"], T);
    const id = await createAccessRequest(db, "wairimu", mentor, T + 1);
    await withdrawAccessRequest(db, "wairimu", id, T + 2);
    expect(await getOnboardingState(db, "wairimu")).toMatchObject({ intents: ["EXPLORING"], inferred: [] });
  });

  it("returns an account that never chose to its inferred intents", async () => {
    const { db } = setup();
    const id = await createAccessRequest(db, "wairimu", mentor, T);
    expect(await getOnboardingState(db, "wairimu")).toMatchObject({ stage: "PROMPT", intents: ["MENTOR"], inferred: [] });
    await withdrawAccessRequest(db, "wairimu", id, T + 1);
    expect(await getOnboardingState(db, "wairimu")).toMatchObject({ stage: "PROMPT", intents: [], inferred: [] });
  });

  it("keeps an alumna a member after she asks to mentor and then withdraws (second review of #260)", async () => {
    const { db, database } = setup();
    database.exec("INSERT INTO studentProfile(id,userId,handle) VALUES ('p','wairimu','wairimu')");
    const id = await createAccessRequest(db, "wairimu", mentor, T);
    expect(await getOnboardingState(db, "wairimu")).toMatchObject({ stage: "PROMPT", intents: ["MEMBER", "MENTOR"], inferred: [] });
    await withdrawAccessRequest(db, "wairimu", id, T + 1);
    expect(await getOnboardingState(db, "wairimu")).toMatchObject({ stage: "PROMPT", intents: ["MEMBER"] });
  });

  it("is refused for someone else's request exactly as for a missing one", async () => {
    const { db, rows } = setup();
    const id = await createAccessRequest(db, "otieno", mentor, T);
    for (const target of [id, "missing"]) {
      const error = await rejection(withdrawAccessRequest(db, "wairimu", target, T + 1));
      expect(error).toMatchObject({ code: "not_found", message: "Request not found." });
    }
    expect(rows("SELECT status FROM access_request")).toEqual([{ status: "PENDING" }]);
    expect(rows("SELECT userId, intent FROM member_intent")).toEqual([{ userId: "otieno", intent: "MENTOR" }]);
  });

  it.each(["APPROVED", "DECLINED"] as const)("is refused once the request is %s, and keeps the intent", async decision => {
    const { db, decide } = setup();
    const id = await createAccessRequest(db, "wairimu", mentor, T);
    decide(id, decision, T + 1);
    expect((await rejection(withdrawAccessRequest(db, "wairimu", id, T + 2))).code).toBe("conflict");
    expect(await getOnboardingState(db, "wairimu")).toMatchObject({ intents: ["MENTOR"], requests: [{ status: decision }] });
  });

  it("does not remove an intent chosen again after the withdrawal when replayed", async () => {
    const { db } = setup();
    await saveIntents(db, "wairimu", ["MEMBER"], T);
    const id = await createAccessRequest(db, "wairimu", mentor, T + 1);
    await withdrawAccessRequest(db, "wairimu", id, T + 2);
    await saveIntents(db, "wairimu", ["MEMBER", "MENTOR"], T + 3);
    expect((await rejection(withdrawAccessRequest(db, "wairimu", id, T + 4))).code).toBe("conflict");
    expect((await getOnboardingState(db, "wairimu")).intents).toEqual(["MEMBER", "MENTOR"]);
  });

  it("does not remove a re-added intent when a replay follows a clock step-back (review of #260)", async () => {
    const { db } = setup();
    const id = await createAccessRequest(db, "wairimu", mentor, T);
    await withdrawAccessRequest(db, "wairimu", id, T - 5);
    await saveIntents(db, "wairimu", ["MEMBER", "MENTOR"], T + 1);
    expect((await rejection(withdrawAccessRequest(db, "wairimu", id, T - 3))).code).toBe("conflict");
    expect((await getOnboardingState(db, "wairimu")).intents).toEqual(["MEMBER", "MENTOR"]);
  });

  it("keeps the request's timeline ordered even if the clock steps back", async () => {
    const { db, rows } = setup();
    await saveIntents(db, "wairimu", ["MEMBER"], T);
    const id = await createAccessRequest(db, "wairimu", mentor, T + 10);
    await withdrawAccessRequest(db, "wairimu", id, T + 5);
    expect(rows("SELECT status, createdAt, updatedAt FROM access_request")).toEqual([{ status: "WITHDRAWN", createdAt: T + 10, updatedAt: T + 10 }]);
    expect((await getOnboardingState(db, "wairimu")).intents).toEqual(["MEMBER"]);
  });
});

describe("markAccessRequestSeen", () => {
  it.each(["APPROVED", "DECLINED"] as const)("marks a %s request seen once, idempotently", async decision => {
    const { db, decide, rows } = setup();
    const id = await createAccessRequest(db, "wairimu", mentor, T);
    decide(id, decision, T + 1, decision === "DECLINED" ? "Thank you for offering." : null);
    await markAccessRequestSeen(db, "wairimu", { id }, T + 2);
    await markAccessRequestSeen(db, "wairimu", { id }, T + 3);
    expect(rows("SELECT requesterSeenAt, updatedAt FROM access_request")).toEqual([{ requesterSeenAt: T + 2, updatedAt: T + 2 }]);
    expect((await getOnboardingState(db, "wairimu")).requests[0].seenAt).toBe(T + 2);
  });

  it("refuses pending and withdrawn requests, and other people's", async () => {
    const { db, rows } = setup();
    const pending = await createAccessRequest(db, "wairimu", mentor, T);
    expect((await rejection(markAccessRequestSeen(db, "wairimu", { id: pending }, T + 1))).code).toBe("conflict");
    await withdrawAccessRequest(db, "wairimu", pending, T + 2);
    expect((await rejection(markAccessRequestSeen(db, "wairimu", { id: pending }, T + 3))).code).toBe("conflict");
    const theirs = await createAccessRequest(db, "otieno", mentor, T);
    expect((await rejection(markAccessRequestSeen(db, "wairimu", { id: theirs }, T + 4))).code).toBe("not_found");
    expect(rows("SELECT requesterSeenAt FROM access_request")).toEqual([{ requesterSeenAt: null }, { requesterSeenAt: null }]);
  });

  it("marks a role's decisions seen when its space is visited, in one statement and only for the owner", async () => {
    const { db, decide, rows } = setup();
    const mine = await createAccessRequest(db, "wairimu", mentor, T);
    const theirs = await createAccessRequest(db, "otieno", mentor, T);
    const organisation = await createAccessRequest(db, "wairimu", institution, T);
    for (const id of [mine, theirs, organisation]) decide(id, "APPROVED", T + 1);
    const prepare = vi.spyOn(db, "prepare");
    await markAccessRequestSeen(db, "wairimu", { role: "MENTOR" }, T + 2);
    await markAccessRequestSeen(db, "wairimu", { role: "MENTOR" }, T + 3);
    expect(prepare).toHaveBeenCalledTimes(2);
    expect(rows("SELECT id, requesterSeenAt FROM access_request ORDER BY id")).toEqual([
      { id: mine, requesterSeenAt: T + 2 }, { id: organisation, requesterSeenAt: null }, { id: theirs, requesterSeenAt: null },
    ].toSorted((a, b) => a.id.localeCompare(b.id)));
  });
});
