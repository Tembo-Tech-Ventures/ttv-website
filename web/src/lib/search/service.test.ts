import { afterEach, describe, expect, it } from "vitest";
import { CAPABILITY_ROLE_MATRIX } from "@/lib/platform/server/capabilities.fixtures";
import { DEMO_PREFIX } from "@/lib/staging-demo-policy";
import { searchPlatform, SEARCH_CANDIDATE_LIMIT, SEARCH_RESULT_LIMIT } from "./service";
import { searchDatabase } from "./test-support";

const databases: ReturnType<typeof searchDatabase>[] = [];
function setup(...args: Parameters<typeof searchDatabase>) { const s = searchDatabase(...args); databases.push(s); return s; }
afterEach(() => databases.splice(0).forEach(s => s.database.close()));

describe("authorized source retrieval", () => {
  it("requires an authenticated identity even when called outside REST", async () => {
    const s = setup();
    await expect(searchPlatform(s.db, "", { q: "Webhook", scope: "all" })).rejects.toThrow("Authentication required");
    expect(s.queries).toEqual([]);
  });
  it.each(CAPABILITY_ROLE_MATRIX.filter(f => f.signedIn !== false))("role matrix: $name", async fixture => {
    const s = setup(fixture);
    const result = await searchPlatform(s.db, s.actor, { q: "Webhook", scope: "all" });
    expect(result.messages).toEqual([]);
    expect(result.people.map(p => p.person.id)).toEqual(["synthetic-otieno"]);
    expect(result.projects.map(p => p.journeyId)).toEqual(fixture.expected.isInstitution || fixture.expected.isAdmin ? ["project-synthetic-otieno"] : []);
    expect(result.sessionMoments.map(m => m.programId)).toEqual(fixture.expected.cohortIds);
    expect(result.sessionMoments.every(m => m.visibility.kind === "COHORT" && m.visibility.label === "Only you and your cohort")).toBe(true);
    const retrieved = JSON.stringify(s.retrieved);
    expect(retrieved).not.toMatch(/secret project|secret staff|secret admissions|Private auth name|pending secret|unscoped secret/);
    if (!fixture.expected.cohortIds.includes("cohort-b")) expect(retrieved).not.toContain("Webhook cohort B secret");
    const transcript = s.queries.find(q => q.sql.includes("FROM transcript_segment"));
    if (fixture.expected.cohortIds.length > 0) expect(transcript?.values[0]).toBe(JSON.stringify(fixture.expected.cohortIds));
    else expect(transcript).toBeUndefined();
    expect(s.queries).toHaveLength(fixture.expected.cohortIds.length > 0 ? 6 : 5);
  });

  it.each(["DRAFT", "SUSPENDED"])("denies %s profiles and their projects even to an institution", async status => {
    const s = setup({ globalRoles: ["INSTITUTION"] });
    s.database.prepare("UPDATE studentProfile SET status=? WHERE userId='synthetic-otieno'").run(status);
    const result = await searchPlatform(s.db, s.actor, { q: "Webhook", scope: "all" });
    expect(result.people).toEqual([]); expect(result.projects).toEqual([]);
    expect(s.retrieved).toEqual([]);
  });

  it("never matches authentication identities, moderation notes or operational data", async () => {
    const s = setup({ globalRoles: ["ADMIN"] });
    for (const q of ["Private auth name", "secret staff note", "secret admissions note", "secret project"]) {
      const result = await searchPlatform(s.db, s.actor, { q, scope: "all" });
      expect(result.people).toEqual([]); expect(result.projects).toEqual([]); expect(result.sessionMoments).toEqual([]);
    }
    expect(s.queries.filter(q => q.sql.includes("WITH candidates")).map(q => q.sql).join("\n")).not.toMatch(/feedback|moderation|application\)|u\.name|u\.email|transcriptText|processingError/);
  });

  it("revocations take effect on the next request, including unpublished source profiles", async () => {
    const s = setup({ applications: [{ programId: "cohort-a", status: "AUDIT" }] });
    expect((await searchPlatform(s.db, s.actor, { q: "Webhook", scope: "all" })).sessionMoments).toHaveLength(1);
    s.database.exec("UPDATE programApplication SET status='REJECTED'; UPDATE studentProfile SET status='SUSPENDED'");
    const result = await searchPlatform(s.db, s.actor, { q: "Webhook", scope: "all" });
    expect(result.people).toEqual([]); expect(result.sessionMoments).toEqual([]);
  });

  it("allows a published owner only institution-shared projects, not their private project", async () => {
    const s = setup({}, "synthetic-otieno");
    const result = await searchPlatform(s.db, s.actor, { q: "Webhook", scope: "projects" });
    expect(result.projects).toHaveLength(1);
    expect(result.projects[0]).toMatchObject({ journeyId: "project-synthetic-otieno", version: 3, href: "/dashboard/community", visibility: { label: "Shared with approved institutions" } });
  });

  it("limits demo administrators to demo profiles and explicit demo cohort membership", async () => {
    const actor = DEMO_PREFIX + "member-cohort";
    const s = setup({ globalRoles: ["ADMIN"], assignments: [{ programId: "cohort-a", name: "MENTOR" }] }, actor);
    s.database.prepare("INSERT INTO program(id,name,description,curriculumId) VALUES (?,'Demo','Test','curriculum')").run(DEMO_PREFIX + "program");
    s.database.prepare("INSERT INTO programRole(id,userId,programId,name) VALUES ('demo-assignment',?,?,'MENTOR')").run(actor, DEMO_PREFIX + "program");
    s.database.prepare("INSERT INTO recording(id,programId,title,processingStatus) VALUES ('demo-recording',?,'Demo session','complete')").run(DEMO_PREFIX + "program");
    s.database.exec("INSERT INTO transcript_segment(id,recordingId,startTime,endTime,text) VALUES ('demo-segment','demo-recording',1,2,'Webhook demo evidence')");
    const result = await searchPlatform(s.db, actor, { q: "Webhook", scope: "all" });
    expect(result.people).toEqual([]); expect(result.projects).toEqual([]);
    expect(result.sessionMoments.map(m => m.recordingId)).toEqual(["demo-recording"]);
    expect(JSON.stringify(s.retrieved)).not.toContain("cohort A evidence");
  });

  it("emits supported citations using source timestamps and encoded path segments", async () => {
    const s = setup({ applications: [{ programId: "cohort-a", status: "APPROVED" }], globalRoles: ["INSTITUTION"] });
    const result = await searchPlatform(s.db, s.actor, { q: "Webhook", scope: "all" });
    expect(result.sessionMoments[0]).toMatchObject({ recordingId: "recording-a", title: "Session A", startSeconds: 12.5, quote: "Webhook cohort A evidence", href: "/dashboard/sessions/recording-a?t=12" });
    expect(result.people[0]?.href).toBe("/talent/synthetic-otieno");
    expect(result.projects[0]?.href).toBe("/dashboard/discover?profile=synthetic-otieno");
  });

  it("treats SQL wildcards and injection strings literally", async () => {
    const s = setup({ globalRoles: ["INSTITUTION"] });
    for (const q of ["%", "_", "' OR 1=1 --"]) {
      expect((await searchPlatform(s.db, s.actor, { q, scope: "all" })).people).toEqual([]);
    }
  });

  it("caps candidate text, result counts and work independently of corpus size", async () => {
    const s = setup({ applications: [{ programId: "cohort-a", status: "APPROVED" }] });
    const insert = s.database.prepare("INSERT INTO transcript_segment(id,recordingId,startTime,endTime,text) VALUES (?,'recording-a',?,?,'Webhook synthetic bounded evidence')");
    for (let i = 0; i < SEARCH_CANDIDATE_LIMIT + 1; i++) insert.run(`a-${String(i).padStart(4, "0")}`, i, i + 1);
    const result = await searchPlatform(s.db, s.actor, { q: "Webhook", scope: "sessionMoments" });
    expect(result.sessionMoments).toHaveLength(SEARCH_RESULT_LIMIT);
    expect(s.queries).toHaveLength(4);
    expect(s.queries[3]?.sql).toContain(`LIMIT ${SEARCH_CANDIDATE_LIMIT}`);
    expect(s.queries[3]?.sql).toContain("substr(s.text,1,4000)");
    expect(result.sessionMoments.every(m => m.quote.length <= 500)).toBe(true);
    // A match outside the bounded window is deliberately not retrieved.
    s.database.exec("UPDATE transcript_segment SET text='Unique beyond window' WHERE id='segment-a'");
    expect((await searchPlatform(s.db, s.actor, { q: "Unique beyond window", scope: "sessionMoments" })).sessionMoments).toEqual([]);
  });
});
