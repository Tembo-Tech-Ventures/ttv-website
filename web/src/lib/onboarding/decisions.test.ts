import { afterEach, describe, expect, it, vi } from "vitest";
import { accessRequestAttention } from "@/lib/attention/producers";
import { createCommunityService } from "@/lib/community/service";
import { AdminAccessRequest, OnboardingState, type CreateAccessRequest } from "@/lib/platform/contracts";
import {
  ACCESS_REQUEST_PAGE_SIZE, AccessRequestCursorError, decideAccessRequest, getAdminAccessRequest, grantCommunityRole,
  listAccessRequests, revokeCommunityRole,
} from "./decisions";
import { OnboardingError, createAccessRequest, getOnboardingState, withdrawAccessRequest } from "./service";
import { onboardingDatabase } from "./test-support";

const T = Date.parse("2026-11-01T08:00:00Z");
const mentor: CreateAccessRequest = { role: "MENTOR", note: "I review mobile apps and API designs for junior developers.", link: null };
const institution: CreateAccessRequest = {
  role: "INSTITUTION", note: "We want to find junior mobile developers for paid internships.",
  organisation: "Savanna Mobile Labs", organisationRole: "Engineering lead", link: "https://example.com/savanna", scopeAcknowledged: true,
};

const setups: { database: { close(): void } }[] = [];
function setup(spaces: "OFF" | "STAFF" | "ALL" = "ALL") {
  const fixture = onboardingDatabase();
  fixture.grant("amina", "ADMIN");
  fixture.database.prepare("UPDATE feature_flag SET audience = ? WHERE key = 'spaces'").run(spaces);
  const context = { db: fixture.db, env: { DEPLOYMENT_ENVIRONMENT: "production" } };
  const decide = (id: string, decision: "approve" | "decline", at = T + 10, message?: string) =>
    decideAccessRequest(context, { id, actorId: "amina", decision, message }, at);
  const rolesOf = (userId: string) => fixture.rows(`SELECT r.name FROM UserRoles ur JOIN Roles r ON r.id = ur.roleId
    WHERE ur.userId = ? ORDER BY r.name`, userId).map((row) => row.name);
  const attention = () => fixture.rows(`SELECT userId, kind, space, category, actorId, eventKey, subjectKind, subjectId,
    subjectHref, subjectLabel, summary FROM attention_item ORDER BY userId, kind`);
  /** The invariant every race must keep: no access role without an approved request or a direct grant. */
  const rolesWithoutApproval = () => fixture.rows(`SELECT ur.userId, r.name FROM UserRoles ur JOIN Roles r ON r.id = ur.roleId
    WHERE r.name IN ('MENTOR', 'INSTITUTION') AND NOT EXISTS (SELECT 1 FROM access_request a
      WHERE a.userId = ur.userId AND a.role = r.name AND a.status = 'APPROVED')`);
  const value = { ...fixture, context, decide, rolesOf, attention, rolesWithoutApproval };
  setups.push(value);
  return value;
}
afterEach(() => { setups.splice(0).forEach((fixture) => fixture.database.close()); vi.restoreAllMocks(); });

async function rejection(promise: Promise<unknown>) {
  const error = await promise.then(() => null, (reason: unknown) => reason);
  expect(error).toBeInstanceOf(OnboardingError);
  return error as OnboardingError;
}

describe("decideAccessRequest", () => {
  it("approves: grants exactly the requested role and tells the requester without naming anyone", async () => {
    const s = setup();
    const id = await createAccessRequest(s.db, "wairimu", mentor, T);
    const decided = await s.decide(id, "approve", T + 10, "  Welcome aboard, Wairimu.  ");

    expect(AdminAccessRequest.parse(decided)).toEqual(decided);
    expect(decided).toMatchObject({ id, status: "APPROVED", decidedAt: T + 10, decisionMessage: "Welcome aboard, Wairimu.",
      decidedBy: { id: "amina", name: "Amina Hassan" }, requester: { id: "wairimu" } });
    expect(s.rolesOf("wairimu")).toEqual(["MENTOR"]);
    const [row] = s.rows("SELECT decisionId, decidedBy FROM access_request WHERE id = ?", id);
    expect(row).toMatchObject({ decidedBy: "amina" });
    expect(s.attention()).toEqual([{
      userId: "wairimu", kind: "access_decided", space: "community", category: "updates", actorId: null,
      eventKey: JSON.stringify(["access_decided", id, row.decisionId]), subjectKind: "accessRequest", subjectId: id,
      subjectHref: "/dashboard/account#taking-part", subjectLabel: "Mentor access", summary: "Mentoring is open.",
    }]);
  });

  it("declines: grants nothing, keeps the message and uses the institution wording", async () => {
    const s = setup();
    const id = await createAccessRequest(s.db, "otieno", institution, T);
    const decided = await s.decide(id, "decline", T + 10, "We can't add more organisations this month.");
    expect(decided).toMatchObject({ status: "DECLINED", decisionMessage: "We can't add more organisations this month." });
    expect(s.rolesOf("otieno")).toEqual([]);
    expect(s.attention()).toMatchObject([
      { userId: "otieno", actorId: null, subjectLabel: "Institution access", summary: "Institution access wasn't approved this time." },
    ]);
  });

  it("never tells the requester who decided", async () => {
    const s = setup();
    const id = await createAccessRequest(s.db, "wairimu", mentor, T);
    await s.decide(id, "decline", T + 10, "Thanks for offering.");
    const state = await getOnboardingState(s.db, "wairimu");
    expect(OnboardingState.parse(state).requests[0]).toMatchObject({ status: "DECLINED", decisionMessage: "Thanks for offering." });
    expect(JSON.stringify(state)).not.toMatch(/amina|Amina|decidedBy/);
    expect(JSON.stringify(s.attention())).not.toMatch(/amina|Amina/);
  });

  it.each([
    ["missing", async () => "missing", "not_found"],
    ["withdrawn", async (s: ReturnType<typeof setup>) => {
      const id = await createAccessRequest(s.db, "wairimu", mentor, T);
      await withdrawAccessRequest(s.db, "wairimu", id, T + 1);
      return id;
    }, "conflict"],
    ["declined", async (s: ReturnType<typeof setup>) => {
      const id = await createAccessRequest(s.db, "wairimu", mentor, T);
      await s.decide(id, "decline", T + 1);
      return id;
    }, "conflict"],
  ] as const)("refuses a %s request and changes nothing", async (_name, arrange, code) => {
    const s = setup();
    const id = await arrange(s);
    const before = s.rows("SELECT * FROM access_request");
    const attentionBefore = s.attention();
    expect((await rejection(s.decide(id, "approve", T + 20))).code).toBe(code);
    expect(s.rows("SELECT * FROM access_request")).toEqual(before);
    expect(s.attention()).toEqual(attentionBefore);
    expect(s.rolesOf("wairimu")).toEqual([]);
  });

  it("refuses to approve without the role row, rather than approving into nothing", async () => {
    const s = setup();
    const id = await createAccessRequest(s.db, "wairimu", mentor, T);
    s.database.exec("DELETE FROM Roles WHERE name = 'MENTOR'");
    await expect(s.decide(id, "approve")).rejects.toThrow(/apply the community migrations/);
    expect(s.rows("SELECT status FROM access_request")).toEqual([{ status: "PENDING" }]);
  });

  it("writes the decision in one batch, after a single audience read", async () => {
    const s = setup();
    const id = await createAccessRequest(s.db, "wairimu", mentor, T);
    const prepare = vi.spyOn(s.db, "prepare");
    const batch = vi.spyOn(s.db, "batch");
    await s.decide(id, "approve");
    expect(batch).toHaveBeenCalledOnce();
    expect(batch.mock.calls[0][0]).toHaveLength(3);
    // The audience, three batched statements, then the re-read for the response.
    expect(prepare).toHaveBeenCalledTimes(5);
  });

  it("follows the requester's spaces audience: nothing while OFF, nothing for non-staff while STAFF", async () => {
    for (const audience of ["OFF", "STAFF"] as const) {
      const s = setup(audience);
      const id = await createAccessRequest(s.db, "wairimu", mentor, T);
      await s.decide(id, "approve");
      expect(s.rolesOf("wairimu")).toEqual(["MENTOR"]);
      expect(s.attention()).toEqual([]);
    }
  });
});

// D1 runs each batch whole, one after another, and an approval reads nothing before its batch: so
// "withdraw, then approve" is also the stale case, an approval prepared while the request was pending.
describe("decision races", () => {
  it.each([
    ["approve, then withdraw", "approve", "withdraw", "APPROVED", ["MENTOR"]],
    ["withdraw, then approve", "withdraw", "approve", "WITHDRAWN", []],
    ["approve, then decline", "approve", "decline", "APPROVED", ["MENTOR"]],
    ["decline, then approve", "decline", "approve", "DECLINED", []],
    ["approve, then approve again", "approve", "approve", "APPROVED", ["MENTOR"]],
  ] as const)("%s: the first wins, the second is a conflict, and no role exists without APPROVED", async (_name, first, second, status, roles) => {
    const s = setup();
    const id = await createAccessRequest(s.db, "wairimu", mentor, T);
    const act = (action: "approve" | "decline" | "withdraw", at: number) => action === "withdraw"
      ? withdrawAccessRequest(s.db, "wairimu", id, at)
      : s.decide(id, action, at);

    await act(first, T + 10);
    expect((await rejection(act(second, T + 11))).code).toBe("conflict");

    expect(s.rows("SELECT status FROM access_request")).toEqual([{ status }]);
    expect(s.rolesOf("wairimu")).toEqual(roles);
    expect(s.rolesWithoutApproval()).toEqual([]);
    expect(s.rows("SELECT count(*) AS n FROM attention_item WHERE kind = 'access_decided'"))
      .toEqual([{ n: status === "WITHDRAWN" ? 0 : 1 }]);
  });
});

describe("grantCommunityRole and revokeCommunityRole", () => {
  it("grants a role and answers the pending request for it, as APPROVED", async () => {
    const s = setup();
    const mentorRequest = await createAccessRequest(s.db, "wairimu", mentor, T);
    const institutionRequest = await createAccessRequest(s.db, "wairimu", institution, T + 1);
    await grantCommunityRole(s.context, { userId: "wairimu", role: "MENTOR", actorId: "amina" }, T + 10);

    expect(s.rolesOf("wairimu")).toEqual(["MENTOR"]);
    expect(s.rows("SELECT id, status, decidedBy, decidedAt, decisionMessage FROM access_request ORDER BY createdAt")).toEqual([
      { id: mentorRequest, status: "APPROVED", decidedBy: "amina", decidedAt: T + 10, decisionMessage: null },
      { id: institutionRequest, status: "PENDING", decidedBy: null, decidedAt: null, decisionMessage: null },
    ]);
    expect(s.attention()).toMatchObject([{ userId: "wairimu", kind: "access_decided", actorId: null, subjectId: mentorRequest }]);
    expect((await getOnboardingState(s.db, "wairimu")).requests.map((request) => request.status)).toEqual(["APPROVED", "PENDING"]);
  });

  it("is idempotent and grants without a request", async () => {
    const s = setup();
    await grantCommunityRole(s.context, { userId: "otieno", role: "INSTITUTION", actorId: "amina" }, T);
    await grantCommunityRole(s.context, { userId: "otieno", role: "INSTITUTION", actorId: "amina" }, T + 1);
    expect(s.rolesOf("otieno")).toEqual(["INSTITUTION"]);
    expect(s.rows("SELECT * FROM access_request")).toEqual([]);
    expect(s.attention()).toEqual([]);
  });

  it("revokes only the role, leaving the request history as it was", async () => {
    const s = setup();
    const id = await createAccessRequest(s.db, "wairimu", mentor, T);
    await s.decide(id, "approve");
    s.grant("wairimu", "INSTITUTION");
    await revokeCommunityRole(s.db, "wairimu", "MENTOR");
    await revokeCommunityRole(s.db, "wairimu", "MENTOR");
    expect(s.rolesOf("wairimu")).toEqual(["INSTITUTION"]);
    expect(s.rows("SELECT status FROM access_request")).toEqual([{ status: "APPROVED" }]);
    // Role state wins: the approval no longer reads as held.
    expect((await getOnboardingState(s.db, "wairimu")).roles).toEqual(["INSTITUTION"]);
  });

  it("refuses roles outside MENTOR and INSTITUTION", async () => {
    const s = setup();
    // @ts-expect-error ADMIN is not an access role.
    await expect(grantCommunityRole(s.context, { userId: "wairimu", role: "ADMIN", actorId: "amina" })).rejects.toThrow(/Invalid option/);
    // @ts-expect-error ADMIN is not an access role.
    await expect(revokeCommunityRole(s.db, "amina", "ADMIN")).rejects.toThrow(/Invalid option/);
    expect(s.rolesOf("wairimu")).toEqual([]);
    expect(s.rolesOf("amina")).toEqual(["ADMIN"]);
  });
});

describe("setAccess, through grantCommunityRole and revokeCommunityRole", () => {
  it("answers the pending request when an administrator grants the role directly", async () => {
    const s = setup();
    const id = await createAccessRequest(s.db, "wairimu", mentor, T);
    const service = createCommunityService(s.db, "amina", null, "production");
    expect(await service.setAccess({ userId: "wairimu", role: "MENTOR", granted: true }))
      .toEqual({ userId: "wairimu", role: "MENTOR", granted: true });
    expect(s.rows("SELECT status, decidedBy FROM access_request WHERE id = ?", id)).toEqual([{ status: "APPROVED", decidedBy: "amina" }]);
    expect(s.attention()).toMatchObject([{ userId: "wairimu", kind: "access_decided", actorId: null }]);

    expect(await service.setAccess({ userId: "wairimu", role: "MENTOR", granted: false }))
      .toEqual({ userId: "wairimu", role: "MENTOR", granted: false });
    expect(s.rolesOf("wairimu")).toEqual([]);
    expect(s.rows("SELECT status FROM access_request")).toEqual([{ status: "APPROVED" }]);
  });
});

describe("accessRequestAttention", () => {
  it("fans out once per administrator, never to the requester, and only while the request is pending", async () => {
    const s = setup();
    s.grant("otieno", "ADMIN");
    s.grant("wairimu", "ADMIN");
    const id = await createAccessRequest(s.db, "wairimu", mentor, T);
    await accessRequestAttention(s.context, id);
    await accessRequestAttention(s.context, id);
    expect(s.attention().map((item) => [item.userId, item.kind, item.category, item.actorId])).toEqual([
      ["amina", "access_request", "requests", "wairimu"],
      ["otieno", "access_request", "requests", "wairimu"],
    ]);

    const withdrawn = await createAccessRequest(s.db, "otieno", institution, T);
    await withdrawAccessRequest(s.db, "otieno", withdrawn, T + 1);
    await accessRequestAttention(s.context, withdrawn);
    await accessRequestAttention(s.context, "missing");
    expect(s.attention()).toHaveLength(2);
  });

  it("writes nothing while spaces is OFF, and survives a failing write", async () => {
    const s = setup("OFF");
    const id = await createAccessRequest(s.db, "wairimu", mentor, T);
    await accessRequestAttention(s.context, id);
    expect(s.attention()).toEqual([]);

    s.database.exec("UPDATE feature_flag SET audience = 'ALL' WHERE key = 'spaces'; DROP TABLE attention_item");
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    await expect(accessRequestAttention(s.context, id)).resolves.toBeUndefined();
    expect(warn).toHaveBeenCalledWith("Attention event could not be recorded.");
  });

  it("still decides when the audience cannot be read", async () => {
    const s = setup();
    const id = await createAccessRequest(s.db, "wairimu", mentor, T);
    s.database.exec("DROP TABLE feature_flag");
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    await expect(s.decide(id, "approve")).resolves.toMatchObject({ status: "APPROVED" });
    expect(s.rolesOf("wairimu")).toEqual(["MENTOR"]);
    expect(warn).toHaveBeenCalledOnce();
  });
});

describe("listAccessRequests", () => {
  function seedQueue(s: ReturnType<typeof setup>, count: number) {
    const insert = s.database.prepare(`INSERT INTO access_request (id, userId, role, status, note, decidedBy, decidedAt, createdAt, updatedAt)
      VALUES (?, 'otieno', 'MENTOR', ?, 'I review mobile apps and API designs for juniors.', ?, ?, ?, ?)`);
    for (let i = 0; i < count; i++) {
      const decided = i % 2 === 1;
      // Ids sort against creation order, so the keyset tie-break is exercised.
      insert.run(`r-${String(count - i).padStart(3, "0")}`, decided ? "DECLINED" : "WITHDRAWN",
        decided ? "amina" : null, decided ? T + 1_000 - i : null, T + Math.floor(i / 2), T + 1_000);
    }
  }

  it("pages pending requests oldest first and decided ones latest decision first, with stable cursors", async () => {
    const s = setup();
    seedQueue(s, 2 * (ACCESS_REQUEST_PAGE_SIZE + 5));
    // A long queue from one person: lift the one-pending-per-role index for this listing test only.
    s.database.exec("DROP INDEX access_request_pending_idx");
    s.database.exec("UPDATE access_request SET status = 'PENDING' WHERE status = 'WITHDRAWN'");

    for (const status of ["PENDING", "DECIDED"] as const) {
      const first = await listAccessRequests(s.db, { status });
      expect(first.items).toHaveLength(ACCESS_REQUEST_PAGE_SIZE);
      expect(first.pendingCount).toBe(ACCESS_REQUEST_PAGE_SIZE + 5);
      const second = await listAccessRequests(s.db, { status, cursor: first.nextCursor ?? undefined });
      expect(second.nextCursor).toBeNull();
      const ids = [...first.items, ...second.items].map((item) => item.id);
      const expected = s.rows(status === "PENDING"
        ? "SELECT id FROM access_request WHERE status = 'PENDING' ORDER BY createdAt, id"
        : "SELECT id FROM access_request WHERE status = 'DECLINED' ORDER BY decidedAt DESC, id DESC").map((row) => row.id);
      expect(ids).toEqual(expected);
      await expect(listAccessRequests(s.db, { status: status === "PENDING" ? "DECIDED" : "PENDING", cursor: first.nextCursor ?? undefined }))
        .rejects.toBeInstanceOf(AccessRequestCursorError);
    }
    await expect(listAccessRequests(s.db, { cursor: "not a cursor" })).rejects.toBeInstanceOf(AccessRequestCursorError);
  });

  it("defaults to the pending queue and reads it in two queries", async () => {
    const s = setup();
    await createAccessRequest(s.db, "wairimu", mentor, T);
    const prepare = vi.spyOn(s.db, "prepare");
    const list = await listAccessRequests(s.db, {});
    expect(list).toMatchObject({ pendingCount: 1, nextCursor: null, items: [{ status: "PENDING", requester: { id: "wairimu" } }] });
    expect(prepare).toHaveBeenCalledTimes(2);
  });

  it("shows who asked and who decided, the GitHub login and the person's earlier requests", async () => {
    const s = setup();
    s.database.exec(`INSERT INTO studentProfile (id, userId, handle, githubLogin) VALUES ('p', 'otieno', 'otieno', 'synthetic-otieno-ouma');
      UPDATE user SET image = 'javascript:alert(1)' WHERE id = 'otieno'`);
    const first = await createAccessRequest(s.db, "otieno", mentor, T);
    await s.decide(first, "decline", T + 5, "Not this time.");
    const second = await createAccessRequest(s.db, "otieno", institution, T + 10);
    const third = await createAccessRequest(s.db, "otieno", mentor, T + 20);
    await withdrawAccessRequest(s.db, "otieno", third, T + 21);
    const fourth = await createAccessRequest(s.db, "otieno", mentor, T + 30);

    const { items } = await listAccessRequests(s.db, {});
    expect(items.map((item) => item.id)).toEqual([second, fourth]);
    expect(items[0]).toMatchObject({
      requester: { id: "otieno", name: "Otieno Ouma", avatarUrl: null }, githubLogin: "synthetic-otieno-ouma",
      organisation: "Savanna Mobile Labs", scopeAcknowledgedAt: T + 10, decidedBy: null,
      earlierRequests: [{ id: first, role: "MENTOR", status: "DECLINED", decisionMessage: "Not this time.", createdAt: T, decidedAt: T + 5 }],
    });
    expect(items[1].earlierRequests.map((request) => [request.id, request.status])).toEqual([[third, "WITHDRAWN"], [first, "DECLINED"]]);

    const decided = await listAccessRequests(s.db, { status: "DECIDED" });
    expect(decided.items).toMatchObject([{ id: first, decidedBy: { id: "amina", name: "Amina Hassan" } }]);
    s.database.exec("DELETE FROM user WHERE id = 'amina'");
    expect(await getAdminAccessRequest(s.db, first)).toMatchObject({ status: "DECLINED", decidedBy: null });
  });
});
