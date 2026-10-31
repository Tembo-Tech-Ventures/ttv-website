import { readdirSync } from "node:fs";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createSqliteD1, readMigration } from "@/test/sqlite-d1";
import { createCommunityService } from "@/lib/community/service";
import { applicationStatusAttention, recordingReadyAttention, visitorMessageAttention, workConfirmedAttention } from "./producers";
import { applyApplicationMutationWithAttention, saveVisitorMessageWithAttention } from "./mutations";
import { buildApplicationTransitionStatement, buildBulkMutationStatement, planApplicationTransition, planBulkProgramApplicationMutation } from "@/lib/admin/program-application";

afterEach(() => vi.restoreAllMocks());
function setup() {
  const s = createSqliteD1();
  for (const file of readdirSync(new URL("../db/migrations/", import.meta.url)).filter(n => n.endsWith(".sql")).toSorted()) s.database.exec(readMigration(file));
  s.database.exec(`INSERT INTO user(id,name,email) VALUES
    ('wanjiku','Wanjiku Njeri','w@example.test'),('otieno','Otieno Ouma','o@example.test'),
    ('mercy','Mercy Wambui','m@example.test'),('amina','Amina Hassan','a@example.test');
    INSERT INTO UserRoles(id,userId,roleId) SELECT 'admin','amina',id FROM Roles WHERE name='ADMIN';
    INSERT INTO UserRoles(id,userId,roleId) SELECT 'mentor','mercy',id FROM Roles WHERE name='MENTOR';
    INSERT INTO curriculum(id,title,description) VALUES ('curriculum','Synthetic curriculum','Test');
    INSERT INTO program(id,name,description,curriculumId) VALUES ('cohort','Synthetic cohort','Test','curriculum'),('other','Other cohort','Test','curriculum');
    INSERT INTO programApplication(id,programId,userId,status,application) VALUES ('application','cohort','wanjiku','APPROVED','{}'),('other-app','other','otieno','APPROVED','{}');
    INSERT INTO recording(id,programId,title,processingStatus) VALUES ('recording/%雪','cohort','Private recording title','complete');
    INSERT INTO studentProfile(id,userId,handle,status) VALUES ('profile','wanjiku','synthetic-wanjiku','PUBLISHED');
    INSERT INTO profileContact(id,profileId,fromName,fromEmail,message) VALUES ('visitor','profile','Untrusted visitor','private@example.test','Private visitor text');
    INSERT INTO communityJourney(id,userId,title,description,occurredAt,visibility) VALUES ('journey','wanjiku','Private contribution title','Test','2026-10-31','institution');
    INSERT INTO communityConfirmation(id,journeyId,mentorId,statement,method,journeyVersion,mentorRole) VALUES ('confirmation','journey','mercy','Private statement','Review',1,'MENTOR');
    UPDATE feature_flag SET audience='ALL' WHERE key='spaces';`);
  const context = { db: s.db, env: { DEPLOYMENT_ENVIRONMENT: "production" } };
  const rows = () => s.database.prepare("SELECT * FROM attention_item ORDER BY userId").all();
  return { ...s, context, rows };
}
type Setup = ReturnType<typeof setup>;
const cases = [
  { name: "application status", run: (s: Setup) => applicationStatusAttention(s.context, ["application"], "amina", "APPROVED"), kind: "application_status", actorId: null, invalidate: "UPDATE programApplication SET status='PENDING' WHERE id='application'" },
  { name: "recording ready", run: (s: Setup) => recordingReadyAttention(s.context, "recording/%雪"), kind: "recording_ready", actorId: null, invalidate: "UPDATE recording SET processingStatus='failed'" },
  { name: "work confirmed", run: (s: Setup) => workConfirmedAttention(s.context, "confirmation"), kind: "work_confirmed", actorId: "mercy", invalidate: "DELETE FROM communityConfirmation" },
  { name: "visitor message", run: (s: Setup) => visitorMessageAttention(s.context, "visitor"), kind: "visitor_message", actorId: null, invalidate: "DELETE FROM profileContact" },
];

describe.each(cases)("$name producer", producer => {
  it("derives the owner/actor from persisted domain data and deduplicates replay", async () => {
    const s = setup();
    try {
      await producer.run(s); await producer.run(s);
      expect(s.rows()).toHaveLength(1);
      expect(s.rows()[0]).toMatchObject({ userId: "wanjiku", actorId: producer.actorId, kind: producer.kind, readAt: null, category: "updates" });
      expect(JSON.stringify(s.rows())).not.toMatch(/Private|private@example|Untrusted/);
      if (producer.kind === "recording_ready") expect(s.rows()[0].subjectHref).toBe("/dashboard/sessions/recording%2F%25%E9%9B%AA");
      s.database.exec("UPDATE attention_item SET readAt=createdAt");
      await producer.run(s);
      expect(s.rows()).toHaveLength(1); expect(s.rows()[0].readAt).not.toBeNull();
    } finally { s.database.close(); }
  });
  it("does not produce for a missing or failed domain event", async () => {
    const s = setup();
    try { s.database.exec(producer.invalidate); await producer.run(s); expect(s.rows()).toEqual([]); }
    finally { s.database.close(); }
  });
  it("writes nothing when OFF even with a production override", async () => {
    const s = setup();
    try {
      s.database.exec("UPDATE feature_flag SET audience='OFF'");
      s.context.env = { DEPLOYMENT_ENVIRONMENT: "production", PLATFORM_FLAGS_OVERRIDE: "all" } as typeof s.context.env;
      const prepare = vi.spyOn(s.db, "prepare");
      await producer.run(s); expect(s.rows()).toEqual([]);
      expect(prepare).toHaveBeenCalledExactlyOnceWith("SELECT audience FROM feature_flag WHERE key='spaces'");
    } finally { s.database.close(); }
  });
  it("fails closed when flag resolution fails", async () => {
    const s = setup();
    try {
      const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
      s.database.exec("DROP TABLE feature_flag");
      await producer.run(s); expect(s.rows()).toEqual([]);
      expect(warn).toHaveBeenCalledOnce();
    } finally { s.database.close(); }
  });
  it("keeps the committed domain event intact on attention storage failure without leaking details", async () => {
    const s = setup();
    try {
      const source = s.database.prepare("SELECT * FROM programApplication").all();
      const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
      const original = s.db.prepare.bind(s.db);
      vi.spyOn(s.db, "prepare").mockImplementation(query => {
        if (query.includes("INSERT INTO attention_item")) throw new Error("secret failed query with private recipient");
        return original(query);
      });
      await expect(producer.run(s)).resolves.toBeUndefined();
      expect(warn).toHaveBeenCalledWith("Attention event could not be recorded.");
      expect(JSON.stringify(warn.mock.calls)).not.toContain("secret");
      expect(s.rows()).toEqual([]); expect(s.database.prepare("SELECT * FROM programApplication").all()).toEqual(source);
    } finally { s.database.close(); }
  });
});

it("application actor must have persisted admin authority", async () => {
  const s = setup();
  try { await applicationStatusAttention(s.context, ["application"], "otieno", "APPROVED"); expect(s.rows()).toEqual([]); }
  finally { s.database.close(); }
});

it("STAFF gates recipients rather than the admin producing an event", async () => {
  const s = setup();
  try {
    s.database.exec("UPDATE feature_flag SET audience='STAFF'");
    await applicationStatusAttention(s.context, ["application"], "amina", "APPROVED"); expect(s.rows()).toEqual([]);
    s.database.exec("INSERT INTO UserRoles(id,userId,roleId) SELECT 'recipient-admin','wanjiku',id FROM Roles WHERE name='ADMIN'");
    await applicationStatusAttention(s.context, ["application"], "amina", "APPROVED"); expect(s.rows()).toHaveLength(1);
  } finally { s.database.close(); }
});

it("recordings notify only explicit approved/audit/completed members and scoped staff, once", async () => {
  const s = setup();
  try {
    for (const [id, status] of [["audit", "AUDIT"], ["alumna", "COMPLETED"], ["pending", "PENDING"], ["rejected", "REJECTED"]]) {
      s.database.prepare("INSERT INTO user(id,name,email) VALUES (?,?,?)").run(id, id, id + "@example.test");
      s.database.prepare("INSERT INTO programApplication(id,userId,programId,status,application) VALUES (?,?,'cohort',?,'{}')").run(id, id, status);
    }
    s.database.exec(`INSERT INTO programRole(id,programId,userId,name) VALUES ('mentor','cohort','mercy','MENTOR'),('ta','cohort','wanjiku','TA');`);
    await recordingReadyAttention(s.context, "recording/%雪");
    expect(s.rows().map(r => r.userId)).toEqual(["alumna", "audit", "mercy", "wanjiku"]);
    s.database.exec("UPDATE recording SET programId=NULL");
    s.database.exec("DELETE FROM attention_item");
    await recordingReadyAttention(s.context, "recording/%雪"); expect(s.rows()).toEqual([]);
  } finally { s.database.close(); }
});

it("confirmation integration emits after authorized commit and never on rejected or duplicate confirmation", async () => {
  const s = setup();
  try {
    s.database.exec("DELETE FROM communityConfirmation");
    const mentor = createCommunityService(s.db, "mercy");
    const input = { expectedRevision: 1, statement: "I reviewed the implementation", method: "Code review" };
    await expect(createCommunityService(s.db, "otieno").confirmJourney("journey", input)).rejects.toMatchObject({ status: 403 });
    expect(s.rows()).toEqual([]);
    await mentor.confirmJourney("journey", input); expect(s.rows()).toHaveLength(1);
    await expect(mentor.confirmJourney("journey", input)).rejects.toMatchObject({ status: 409 });
    expect(s.rows()).toHaveLength(1);
  } finally { s.database.close(); }
});

it("single application mutation emits once after CAS and never on stale failure", async () => {
  const s = setup();
  try {
    s.database.exec("UPDATE programApplication SET status='PENDING' WHERE id='application'");
    const statement = buildApplicationTransitionStatement({ applicationId: "application", transition: planApplicationTransition({
      currentStatus: "PENDING", expectedStatus: "PENDING", targetStatus: "APPROVED",
    }) });
    const input = { statement, applicationIds: ["application"], actorId: "amina", status: "APPROVED" as const, staleCode: "STALE_TRANSITION" as const, staleMessage: "Stale mutation" };
    await applyApplicationMutationWithAttention(s.context, input);
    expect(s.rows()).toHaveLength(1);
    await expect(applyApplicationMutationWithAttention(s.context, input)).rejects.toMatchObject({ code: "STALE_TRANSITION" });
    expect(s.rows()).toHaveLength(1);
    expect(s.database.prepare("SELECT status FROM programApplication WHERE id='application'").get()).toEqual({ status: "APPROVED" });
  } finally { s.database.close(); }
});

it("atomic bulk failure produces nothing; successful bulk emits only for the selected applications", async () => {
  const s = setup();
  try {
    s.database.exec("UPDATE programApplication SET status='PENDING',programId='cohort'");
    const plan = planBulkProgramApplicationMutation({ action: "bulk-approve", programId: "cohort", applicationIds: ["application", "other-app"],
      applications: ["application", "other-app"].map(id => ({ id, programId: "cohort", status: "PENDING" as const })) });
    const input = { statement: buildBulkMutationStatement(plan), applicationIds: plan.applicationIds, actorId: "amina", status: "APPROVED" as const, staleCode: "STALE_BULK_SELECTION" as const, staleMessage: "Stale bulk" };
    s.database.exec("UPDATE programApplication SET status='REJECTED' WHERE id='other-app'");
    await expect(applyApplicationMutationWithAttention(s.context, input)).rejects.toMatchObject({ code: "STALE_BULK_SELECTION" });
    expect(s.rows()).toEqual([]);
    expect(s.database.prepare("SELECT status FROM programApplication WHERE id='application'").get()).toEqual({ status: "PENDING" });
    s.database.exec("UPDATE programApplication SET status='PENDING' WHERE id='other-app'");
    await applyApplicationMutationWithAttention(s.context, input);
    expect(s.rows().map(row => row.userId)).toEqual(["otieno", "wanjiku"]);
  } finally { s.database.close(); }
});

it("visitor insertion emits only after successful insert, with no public identity copied into attention", async () => {
  const s = setup();
  try {
    const input = { profileId: "profile", fromName: "Visitor", fromEmail: "private@example.test", organization: null, message: "Private note" };
    const id = await saveVisitorMessageWithAttention(s.context, input);
    expect(s.rows()).toHaveLength(1);
    expect(s.rows()[0]).toMatchObject({ userId: "wanjiku", subjectId: id, actorId: null });
    await expect(saveVisitorMessageWithAttention(s.context, { ...input, profileId: "missing" })).rejects.toThrow(/FOREIGN KEY/);
    expect(s.rows()).toHaveLength(1);
    expect(s.database.prepare("SELECT COUNT(*) AS count FROM profileContact").get()).toEqual({ count: 2 });
  } finally { s.database.close(); }
});

it("a secondary attention failure does not change successful application, contact or confirmation outcomes", async () => {
  const s = setup();
  try {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    s.database.exec("DROP TABLE attention_item; DELETE FROM communityConfirmation; UPDATE programApplication SET status='PENDING' WHERE id='application'");
    const statement = buildApplicationTransitionStatement({ applicationId: "application", transition: planApplicationTransition({ currentStatus: "PENDING", expectedStatus: "PENDING", targetStatus: "APPROVED" }) });
    await applyApplicationMutationWithAttention(s.context, { statement, applicationIds: ["application"], actorId: "amina", status: "APPROVED" as const, staleCode: "STALE_TRANSITION", staleMessage: "Stale" });
    await saveVisitorMessageWithAttention(s.context, { profileId: "profile", fromName: "Visitor", fromEmail: "visitor@example.test", organization: null, message: "Hello" });
    await createCommunityService(s.db, "mercy").confirmJourney("journey", { expectedRevision: 1, statement: "I reviewed the implementation", method: "Code review" });
    expect(s.database.prepare("SELECT status FROM programApplication WHERE id='application'").get()).toEqual({ status: "APPROVED" });
    expect(s.database.prepare("SELECT COUNT(*) AS count FROM profileContact").get()).toEqual({ count: 2 });
    expect(s.database.prepare("SELECT COUNT(*) AS count FROM communityConfirmation").get()).toEqual({ count: 1 });
  } finally { s.database.close(); }
});

it("does not turn a committed transition into a later status observed during a re-read", async () => {
  const s = setup();
  try {
    // A committed APPROVED, then B committed REJECTED before A's adapter ran.
    s.database.exec("UPDATE programApplication SET status='REJECTED' WHERE id='application'");
    await applicationStatusAttention(s.context, ["application"], "amina", "APPROVED");
    expect(s.rows()).toEqual([]);
    await applicationStatusAttention(s.context, ["application"], "amina", "REJECTED");
    expect(s.rows()).toHaveLength(1);
    expect(s.rows()[0]).toMatchObject({ eventKey: '["application_status","application","REJECTED"]', actorId: null });
  } finally { s.database.close(); }
});

it.each(["OFF", "ALL", "STAFF"] as const)("bounds 90-recipient bulk and recording work when %s", async audience => {
  const s = setup();
  try {
    s.database.prepare("UPDATE feature_flag SET audience=? WHERE key='spaces'").run(audience);
    s.database.exec("DELETE FROM programApplication");
    const ids = Array.from({ length: 90 }, (_, i) => "bulk-" + i);
    for (const id of ids) {
      s.database.prepare("INSERT INTO user(id,name,email) VALUES (?,?,?)").run(id, id, id + "@example.test");
      s.database.prepare("INSERT INTO programApplication(id,userId,programId,status,application) VALUES (?,?,'cohort','PENDING','{}')").run(id, id);
    }
    s.database.exec("INSERT INTO UserRoles(id,userId,roleId) SELECT 'bulk-admin','bulk-0',id FROM Roles WHERE name='ADMIN'");
    const plan = planBulkProgramApplicationMutation({ action: "bulk-approve", programId: "cohort", applicationIds: ids,
      applications: ids.map(id => ({ id, programId: "cohort", status: "PENDING" as const })) });
    const prepare = vi.spyOn(s.db, "prepare");
    await applyApplicationMutationWithAttention(s.context, {
      statement: buildBulkMutationStatement(plan), applicationIds: ids, status: plan.status,
      actorId: "amina", staleCode: "STALE_BULK_SELECTION", staleMessage: "Stale bulk",
    });
    expect(prepare).toHaveBeenCalledTimes(audience === "OFF" ? 2 : 4);
    expect(prepare.mock.calls.filter(([sql]) => sql.includes("feature_flag"))).toHaveLength(1);
    expect(s.rows()).toHaveLength(audience === "OFF" ? 0 : audience === "ALL" ? 90 : 1);
    if (audience === "STAFF") expect(s.rows()[0].userId).toBe("bulk-0");
    prepare.mockClear();
    await recordingReadyAttention(s.context, "recording/%雪");
    expect(prepare).toHaveBeenCalledTimes(audience === "OFF" ? 1 : 3);
    expect(s.rows()).toHaveLength(audience === "OFF" ? 0 : audience === "ALL" ? 180 : 2);
  } finally { s.database.close(); }
});

describe.each(cases)("$name audience isolation", producer => {
  it("requires the recipient's persisted ADMIN role for STAFF", async () => {
    const s = setup();
    try {
      s.database.exec("UPDATE feature_flag SET audience='STAFF'");
      await producer.run(s); expect(s.rows()).toEqual([]);
      s.database.exec("INSERT INTO UserRoles(id,userId,roleId) SELECT 'recipient-admin','wanjiku',id FROM Roles WHERE name='ADMIN'");
      await producer.run(s); expect(s.rows()).toHaveLength(1);
    } finally { s.database.close(); }
  });
  it.each(["PRODUCTION", " Production ", "---production---"])("never uses an override for production alias %s", async environment => {
    const s = setup();
    try {
      s.database.exec("UPDATE feature_flag SET audience='OFF'");
      s.context.env = { DEPLOYMENT_ENVIRONMENT: environment, PLATFORM_FLAGS_OVERRIDE: "all" } as typeof s.context.env;
      await producer.run(s); expect(s.rows()).toEqual([]);
    } finally { s.database.close(); }
  });
  it("honors the explicit isolated-preview override without a flag-table query", async () => {
    const s = setup();
    try {
      s.database.exec("DROP TABLE feature_flag");
      s.context.env = { DEPLOYMENT_ENVIRONMENT: "agent-pr-244", PLATFORM_FLAGS_OVERRIDE: "all" } as typeof s.context.env;
      await producer.run(s); expect(s.rows()).toHaveLength(1);
    } finally { s.database.close(); }
  });
});
