import type { SQLInputValue } from "node:sqlite";
import { afterEach, describe, expect, it } from "vitest";
import { CAPABILITY_ROLE_MATRIX } from "@/lib/platform/server/capabilities.fixtures";
import { DEMO_PREFIX } from "@/lib/staging-demo-policy";
import { ADMIN_SEARCHED_SESSIONS, searchPlatform, SEARCH_RESULT_LIMIT } from "./service";
import { searchDatabase } from "./test-support";
import { recordingScopeSql } from "@/lib/recordings/access";

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
    expect(result.people.map(p => p.person.id)).toEqual(["synthetic-ineligible", "synthetic-otieno", "synthetic-private"]);
    expect(result.projects.map(p => p.journeyId)).toEqual(["project-synthetic-ineligible", "project-synthetic-otieno", "project-synthetic-private"]);
    // The recording access policy: the caller's cohorts; for admins every cohort's and those with no cohort.
    const { isAdmin, cohortIds } = fixture.expected;
    expect(result.sessionMoments.map(m => m.programId)).toEqual(isAdmin ? ["cohort-a", "cohort-b", null] : cohortIds);
    expect(result.sessionMoments.map(m => m.visibility)).toEqual(result.sessionMoments.map(m => m.programId === null
      ? { kind: "PRIVATE", label: "Only admins" } : { kind: "COHORT", label: "Only you and your cohort" }));
    const retrieved = JSON.stringify(s.retrieved);
    expect(retrieved).not.toMatch(/secret project|secret staff|secret admissions|Private auth name|pending secret/);
    if (!isAdmin) expect(retrieved).not.toContain("unscoped secret");
    if (!isAdmin && !cohortIds.includes("cohort-b")) expect(retrieved).not.toContain("Webhook cohort B secret");
    const transcript = s.queries.find(q => q.sql.includes("CROSS JOIN transcript_segment"));
    const reads = isAdmin || cohortIds.length > 0;
    if (reads) expect(transcript?.sql).toContain(recordingScopeSql(fixture.expected, s.actor, "r"));
    else expect(transcript).toBeUndefined();
    expect(s.queries).toHaveLength(reads ? 6 : 5);
  });

  it.each(["SUSPENDED"])("denies %s profiles and their projects even to an institution", async status => {
    const s = setup({ globalRoles: ["INSTITUTION"] });
    s.database.prepare("UPDATE studentProfile SET status=?").run(status);
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
    expect(s.queries.filter(q => q.sql.includes("studentProfile")).map(q => q.sql).join("\n")).not.toMatch(/feedback|moderationFlags|moderationScores|application\)|u\.name|u\.email|transcriptText|processingError/);
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
    expect(result.projects).toHaveLength(3);
    expect(result.projects.find(p=>p.owner.id==="synthetic-otieno")).toMatchObject({ journeyId: "project-synthetic-otieno", version: 3, href: "/dashboard/community/members/synthetic-otieno#work-project-synthetic-otieno", visibility: { label: "Signed-in members" } });
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
    // Every listed person and their work lead to their member page in the app, never to the public site.
    expect(result.people.length).toBeGreaterThan(0);
    for (const hit of result.people) expect(hit.href).toMatch(/^\/dashboard\/community\/members\/[a-z0-9-]+$/);
    for (const hit of result.projects) expect(hit.href).toMatch(/^\/dashboard\/community\/members\/[a-z0-9-]+#work-/);
  });

  it("treats SQL wildcards and injection strings literally", async () => {
    const s = setup({ globalRoles: ["INSTITUTION"] });
    for (const q of ["%", "_", "' OR 1=1 --"]) {
      expect((await searchPlatform(s.db, s.actor, { q, scope: "all" })).people).toEqual([]);
    }
  });

  it("reads an admin's newest sessions only, through the segment index, unless they name a cohort", async () => {
    const s = setup({ globalRoles: ["ADMIN"] });
    const recording = s.database.prepare("INSERT INTO recording(id,programId,title,processingStatus,recordedAt) VALUES (?,'cohort-b',?,'complete',?)");
    const segment = s.database.prepare("INSERT INTO transcript_segment(id,recordingId,startTime,endTime,text) VALUES (?,?,?,?,?)");
    // The oldest session of many, its one mention of "Harambee" far down a long transcript.
    recording.run("oldest", "Oldest session", 1);
    for (let i = 0; i < 300; i++) segment.run(`oldest-${i}`, "oldest", i, i + 1, i === 299 ? "Harambee retrospective" : "Filler words");
    for (let i = 0; i < ADMIN_SEARCHED_SESSIONS; i++) recording.run(`newer-${i}`, `Session ${i}`, 1_000 + i);

    expect((await searchPlatform(s.db, s.actor, { q: "Harambee", scope: "sessionMoments" })).sessionMoments).toEqual([]);
    const transcript = s.queries.findLast(q => q.sql.includes("CROSS JOIN transcript_segment"))!;
    expect(transcript.sql).toContain(`LIMIT ${ADMIN_SEARCHED_SESSIONS}`);
    const plan = s.database.prepare("EXPLAIN QUERY PLAN " + transcript.sql).all(...transcript.values as SQLInputValue[]).map(r => r.detail).join("\n");
    expect(plan).toContain("SEARCH s USING INDEX transcript_segment_recording_time_idx (recordingId=?");
    expect(plan).not.toMatch(/SCAN s\b|SCAN transcript_segment\b/);

    // Naming the cohort searches all of its sessions, by the cohort index.
    const named = await searchPlatform(s.db, s.actor, { q: "Harambee", scope: "sessionMoments", programId: "cohort-b" });
    expect(named.sessionMoments.map(m => [m.recordingId, m.startSeconds])).toEqual([["oldest", 299]]);
    const narrowed = s.queries.findLast(q => q.sql.includes("CROSS JOIN transcript_segment"))!;
    expect(narrowed.sql).not.toContain("LIMIT 60");
    const narrowedPlan = s.database.prepare("EXPLAIN QUERY PLAN " + narrowed.sql).all(...narrowed.values as SQLInputValue[]).map(r => r.detail).join("\n");
    expect(narrowedPlan).toContain("SEARCH r USING INDEX recording_program_idx (programId=?)");
  });

  it("says who sees a hidden session: admins and the cohort's hosts", async () => {
    const s = setup({ globalRoles: ["ADMIN"] });
    s.database.exec("UPDATE recording SET hiddenAt = 1 WHERE id = 'recording-a'");
    const moments = (await searchPlatform(s.db, s.actor, { q: "Webhook", scope: "sessionMoments" })).sessionMoments;
    expect(moments.map(m => [m.recordingId, m.visibility.label])).toEqual([
      ["recording-a", "Only admins and the cohort's hosts"], ["recording-b", "Only you and your cohort"], ["recording-null", "Only admins"],
    ]);
  });

  it("finds late matches in a long session and caps results after matching", async () => {
    const s = setup({ applications: [{ programId: "cohort-a", status: "APPROVED" }] });
    const insert = s.database.prepare("INSERT INTO transcript_segment(id,recordingId,startTime,endTime,text) VALUES (?,'recording-a',?,?,'Webhook synthetic bounded evidence')");
    for (let i = 0; i < 900; i++) insert.run(`a-${String(i).padStart(4, "0")}`, i, i + 1);
    const result = await searchPlatform(s.db, s.actor, { q: "Webhook", scope: "sessionMoments" });
    expect(result.sessionMoments).toHaveLength(SEARCH_RESULT_LIMIT);
    expect(s.queries).toHaveLength(4);
    expect(result.sessionMoments.every(m => m.quote.length <= 500)).toBe(true);
    const retrieval = s.queries[3]!;
    const plan = s.database.prepare("EXPLAIN QUERY PLAN " + retrieval.sql).all(...retrieval.values as SQLInputValue[]).map(r => r.detail).join("\n");
    expect(plan).toContain("SEARCH r USING INDEX recording_program_idx (programId=?)");
    expect(plan).toContain("SEARCH s USING INDEX transcript_segment_recording_time_idx (recordingId=?");
    expect(plan).not.toMatch(/SCAN s\b|SCAN transcript_segment\b/);
    s.database.exec("UPDATE transcript_segment SET text='Unique late evidence' WHERE id='a-0700'");
    expect((await searchPlatform(s.db, s.actor, { q: "Unique late evidence", scope: "sessionMoments" })).sessionMoments)
      .toEqual([expect.objectContaining({ startSeconds: 700, quote: "Unique late evidence" })]);
    s.database.prepare("UPDATE transcript_segment SET text=? WHERE id='a-0700'").run("x".repeat(4500) + " Final evidence");
    expect((await searchPlatform(s.db, s.actor, { q: "Final evidence", scope: "sessionMoments" })).sessionMoments[0]?.quote).toContain("Final evidence");
  });

  it("uses account-name fallbacks for members and matches only skill values", async () => {
    const s = setup();
    s.database.exec(`UPDATE studentProfile SET publicName=NULL,bio='Unrelated',skills='["TypeScript","SQL"]'`);
    for (const q of ["builder", "ttv", '"', "[", ","]) expect((await searchPlatform(s.db, s.actor, { q, scope: "people" })).people).toEqual([]);
    expect((await searchPlatform(s.db, s.actor, { q: "TypeScript", scope: "people" })).people[0]?.person.name).toBe("Private auth name");
    s.database.exec("UPDATE studentProfile SET skills='malformed JSON'");
    expect((await searchPlatform(s.db, s.actor, { q: "malformed", scope: "people" })).people).toEqual([]);
  });

  it.each(["MENTOR", "ADMIN"])("excludes %s project owners as institutional discovery does", async role => {
    const s = setup({ globalRoles: ["INSTITUTION"] });
    s.database.prepare("INSERT OR IGNORE INTO Roles(id,name) VALUES (?,?)").run(role, role);
    s.database.prepare("INSERT INTO UserRoles(id,userId,roleId) SELECT 'owner-role','synthetic-otieno',id FROM Roles WHERE name=?").run(role);
    expect((await searchPlatform(s.db, s.actor, { q: "Webhook", scope: "projects" })).projects.map(p=>p.owner.id)).not.toContain("synthetic-otieno");
  });

  it("folds query and source with the same SQLite ASCII rules", async () => {
    const s = setup();
    s.database.exec("UPDATE studentProfile SET publicName='Émile',bio='SQL'");
    expect((await searchPlatform(s.db, s.actor, { q: "É", scope: "people" })).people).toHaveLength(3);
    expect((await searchPlatform(s.db, s.actor, { q: "sql", scope: "people" })).people).toHaveLength(3);
  });

  it("finds people and projects beyond 500 eligible rows instead of sampling IDs", async () => {
    const s = setup({ globalRoles: ["INSTITUTION"] });
    const user = s.database.prepare("INSERT INTO user(id,name,email) VALUES (?,'Synthetic',?)");
    const profile = s.database.prepare("INSERT INTO studentProfile(id,userId,handle,status,publicName,bio) VALUES (?,?,?,'PUBLISHED','Synthetic','Ordinary work')");
    const completion = s.database.prepare("INSERT INTO programApplication(id,userId,programId,status,completedAt,application) VALUES (?,?,'cohort-a','COMPLETED',1,'{}')");
    const project = s.database.prepare("INSERT INTO communityJourney(id,userId,title,description,occurredAt,visibility) VALUES (?,?,'Ordinary project','Evidence','2026-10-31','institution')");
    for (let i = 0; i < 600; i++) {
      const id = `candidate-${String(i).padStart(4, "0")}`;
      user.run(id, id + "@example.test"); profile.run(id, id, id); completion.run(id, id); project.run(id, id);
    }
    s.database.prepare("UPDATE studentProfile SET bio=? WHERE id='candidate-0599'").run("x".repeat(4500) + " Rare evidence");
    s.database.prepare("UPDATE communityJourney SET description=? WHERE id='candidate-0599'").run("x".repeat(4500) + " Rare evidence");
    const result = await searchPlatform(s.db, s.actor, { q: "Rare evidence", scope: "all" });
    expect(result.people.map(p => p.person.id)).toEqual(["candidate-0599"]);
    expect(result.projects.map(p => p.journeyId)).toEqual(["candidate-0599"]);
  });
});
