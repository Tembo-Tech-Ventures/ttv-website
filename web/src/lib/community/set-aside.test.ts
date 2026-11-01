import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { DEMO_PERSONAS } from "@/lib/staging-demo-policy";
import { createSqliteD1, readMigration } from "@/test/sqlite-d1";
import * as assessmentProvider from "./assessment-provider";
import type { CommunityActor } from "./actor";
import { handleCommunityRequest } from "./http";
import { createCommunityService } from "./service";

/**
 * F-7 (QA1R-02): a mentor can privately set aside shared work they can't
 * confirm. It leaves only that mentor's waiting list, a new revision waits
 * again, and nobody else (the member, other mentors, institutions, the
 * assessment, search and discovery) can tell it happened.
 */

const databases: { close(): void }[] = [];
afterEach(() => {
  databases.splice(0).forEach((database) => database.close());
  vi.restoreAllMocks();
});

const MIGRATIONS = readdirSync(new URL("../db/migrations/", import.meta.url)).filter((name) => name.endsWith(".sql")).toSorted();
const ON = { DEPLOYMENT_ENVIRONMENT: "agent-pr-1", PLATFORM_FLAGS_OVERRIDE: "all" } as Env;
const OFF = { DEPLOYMENT_ENVIRONMENT: "production", PLATFORM_FLAGS_OVERRIDE: "all" } as Env;
const contribution = {
  title: "Chama savings ledger", description: "Built and tested a fictional ledger for a savings group.",
  evidenceUrl: "https://github.com/example/chama-ledger", occurredAt: "2026-10-20", visibility: "institution",
} as const;
const profile = { headline: "Builder", bio: "Builds tools for savings groups", skills: ["TypeScript"], opportunityGoals: "First developer role" };

function setup() {
  const { database, db } = createSqliteD1();
  databases.push(database);
  for (const name of MIGRATIONS) database.exec(readMigration(name));
  const people = [["member", "Achieng Otieno"], ["member2", "Brian Kiprop"], ["mentor", "Kamau Njoroge"], ["mentor2", "Wanjiru Mwangi"], ["institution", "Savanna Labs"], ["admin", "Amina Hassan"]];
  for (const [id, name] of people) database.prepare(`INSERT INTO "user"(id,name,email) VALUES (?,?,?)`).run(id, name, `${id}@example.test`);
  for (const [userId, role] of [["mentor", "MENTOR"], ["mentor2", "MENTOR"], ["institution", "INSTITUTION"], ["admin", "ADMIN"]]) {
    database.prepare(`INSERT INTO "UserRoles"(id,userId,roleId) VALUES (?,?,(SELECT id FROM "Roles" WHERE name=?))`).run(`${userId}-${role}`, userId, role);
  }
  const as = (id: string) => createCommunityService(db, id);
  return { database, db, as, member: as("member"), mentor: as("mentor"), mentor2: as("mentor2"), institution: as("institution"), admin: as("admin") };
}

const browser = (id: string): CommunityActor => ({ id, scopes: null });
async function call(db: D1Database, actor: CommunityActor, method: string, path: string, body?: unknown, env: Env = ON, origin = "https://ttv.example") {
  const request = new Request(`https://ttv.example/api/community/${path}`, {
    method, headers: { Origin: origin, "Content-Type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body),
  });
  const response = await handleCommunityRequest(request, path.split("?")[0], actor, db, env);
  return { status: response.status, json: await response.json() as Record<string, unknown> };
}
const setAsideRows = (f: ReturnType<typeof setup>) => f.database.prepare("SELECT mentorId,journeyId,journeyVersion FROM communitySetAside ORDER BY mentorId,journeyId,journeyVersion").all();

describe("mentor private set-aside", () => {
  it("leaves the mentor's waiting count and list, and undo restores it", async () => {
    const f = setup();
    const a = await f.member.createJourney(contribution);
    const b = await f.member.createJourney({ ...contribution, title: "M-Pesa receipts tracker" });
    expect(await f.mentor.countAwaitingConfirmation()).toBe(2);

    expect(await f.mentor.setAsideJourney(a.id, { expectedRevision: 1 })).toEqual({ journeyId: a.id, journeyVersion: 1, setAside: true });
    expect(await f.mentor.countAwaitingConfirmation()).toBe(1);
    const listed = await f.mentor.listMentorship();
    expect(listed.map((entry) => [entry.id, entry.setAsideByCurrentMentor, entry.reviewedByCurrentMentor]).toSorted())
      .toEqual([[a.id, true, false], [b.id, false, false]].toSorted());
    // Private to this mentor: another mentor still has both waiting.
    expect(await f.mentor2.countAwaitingConfirmation()).toBe(2);
    expect((await f.mentor2.listMentorship()).every((entry) => !entry.setAsideByCurrentMentor)).toBe(true);

    // Setting the same revision aside twice is a no-op.
    await f.mentor.setAsideJourney(a.id, { expectedRevision: 1 });
    expect(setAsideRows(f)).toEqual([{ mentorId: "mentor", journeyId: a.id, journeyVersion: 1 }]);

    expect(await f.mentor.undoSetAside(a.id)).toEqual({ journeyId: a.id, setAside: false });
    expect(await f.mentor.countAwaitingConfirmation()).toBe(2);
    expect((await f.mentor.listMentorship()).find((entry) => entry.id === a.id)?.setAsideByCurrentMentor).toBe(false);
    // Undo is idempotent too.
    await f.mentor.undoSetAside(a.id);
    expect(setAsideRows(f)).toEqual([]);
  });

  it("puts a contribution back in the waiting list when the member makes a new revision", async () => {
    const f = setup();
    const a = await f.member.createJourney(contribution);
    await f.mentor.setAsideJourney(a.id, { expectedRevision: 1 });
    expect(await f.mentor.countAwaitingConfirmation()).toBe(0);

    await f.member.updateJourney(a.id, { ...contribution, description: "Added reconciliation tests to the ledger.", expectedRevision: 1 });
    expect(await f.mentor.countAwaitingConfirmation()).toBe(1);
    expect((await f.mentor.listMentorship())[0]).toMatchObject({ id: a.id, version: 2, setAsideByCurrentMentor: false });
    await expect(f.mentor.setAsideJourney(a.id, { expectedRevision: 1 })).rejects.toMatchObject({ status: 409 });
    await f.mentor.setAsideJourney(a.id, { expectedRevision: 2 });
    expect(await f.mentor.countAwaitingConfirmation()).toBe(0);

    // Unpublishing and sharing again is a new revision as well.
    await f.member.setJourneyVisibility(a.id, { visibility: "private" });
    expect(await f.mentor.listMentorship()).toEqual([]);
    await f.member.setJourneyVisibility(a.id, { visibility: "institution" });
    expect((await f.mentor.listMentorship())[0]).toMatchObject({ id: a.id, version: 4, setAsideByCurrentMentor: false });
    expect(await f.mentor.countAwaitingConfirmation()).toBe(1);
    // Undo clears this mentor's set-asides for the contribution, at every revision.
    await f.mentor.undoSetAside(a.id);
    expect(setAsideRows(f)).toEqual([]);
  });

  it("only sets aside shared work by someone else that waits for this mentor, and only undoes their own", async () => {
    const f = setup();
    const shared = await f.member.createJourney(contribution);
    const draft = await f.member.createJourney({ ...contribution, visibility: "private" });
    const own = await f.mentor.createJourney(contribution);
    const revision = { expectedRevision: 1 };

    for (const service of [f.member, f.institution, f.as("member2")]) await expect(service.setAsideJourney(shared.id, revision)).rejects.toMatchObject({ status: 403 });
    await expect(f.mentor.setAsideJourney(own.id, revision)).rejects.toMatchObject({ status: 403 });
    await expect(f.mentor.setAsideJourney(draft.id, revision)).rejects.toMatchObject({ status: 404 });
    await expect(f.mentor.setAsideJourney("missing", revision)).rejects.toMatchObject({ status: 404 });
    await expect(f.mentor.setAsideJourney(shared.id, { expectedRevision: 2 })).rejects.toMatchObject({ status: 409 });
    for (const input of [{}, { expectedRevision: 0 }, { expectedRevision: "1" }, { expectedRevision: 1, mentorId: "mentor2" }]) {
      await expect(f.mentor.setAsideJourney(shared.id, input)).rejects.toMatchObject({ status: 400 });
    }
    // Work this mentor already confirmed is no longer waiting for them.
    await f.mentor2.confirmJourney(shared.id, { ...revision, statement: "I read the ledger code and its tests", method: "Repository review" });
    await expect(f.mentor2.setAsideJourney(shared.id, revision)).rejects.toMatchObject({ status: 409 });
    for (const service of [f.member, f.institution]) await expect(service.undoSetAside(shared.id)).rejects.toMatchObject({ status: 403 });
    expect(setAsideRows(f)).toEqual([]);

    // Admins review on the Confirm page too, so they may set aside as well.
    await f.admin.setAsideJourney(shared.id, revision);
    await f.mentor.setAsideJourney(shared.id, revision);
    await f.mentor2.undoSetAside(shared.id);
    expect(setAsideRows(f)).toEqual([
      { mentorId: "admin", journeyId: shared.id, journeyVersion: 1 },
      { mentorId: "mentor", journeyId: shared.id, journeyVersion: 1 },
    ]);
    f.database.prepare(`DELETE FROM "UserRoles" WHERE userId='mentor'`).run();
    await expect(f.mentor.undoSetAside(shared.id)).rejects.toMatchObject({ status: 403 });
    await expect(f.mentor.setAsideJourney(shared.id, revision)).rejects.toMatchObject({ status: 403 });
  });

  it("keeps the demo mentor to demo members", async () => {
    const f = setup();
    const demoMentor = DEMO_PERSONAS.mentor.userId, demoMember = DEMO_PERSONAS["member-cohort"].userId;
    for (const id of [demoMentor, demoMember]) f.database.prepare(`INSERT INTO "user"(id,name,email) VALUES (?,?,?)`).run(id, id, `${id}@invalid.ttv`);
    f.database.prepare(`INSERT INTO "UserRoles"(id,userId,roleId) VALUES ('demo-mentor',?,(SELECT id FROM "Roles" WHERE name='MENTOR'))`).run(demoMentor);
    const real = await f.member.createJourney(contribution);
    const demo = await createCommunityService(f.db, demoMember, null, "staging").createJourney(contribution);
    const mentor = createCommunityService(f.db, demoMentor, null, "staging");
    await expect(mentor.setAsideJourney(real.id, { expectedRevision: 1 })).rejects.toMatchObject({ status: 404 });
    await mentor.setAsideJourney(demo.id, { expectedRevision: 1 });
    expect(await mentor.countAwaitingConfirmation()).toBe(0);
  });

  it("changes nothing the member, other mentors, institutions, admins, search, discovery or the assessment can see", async () => {
    const f = setup();
    await f.member.updateOwnProfile(profile);
    const a = await f.member.createJourney(contribution);
    await f.member.createJourney({ ...contribution, title: "Draft", visibility: "private" });
    await f.mentor2.confirmJourney(a.id, { expectedRevision: 1, statement: "I read the ledger code and its tests", method: "Repository review" });
    const complete = vi.fn().mockResolvedValue(JSON.stringify({ criteria: [{ criterionId: "tool", status: "insufficient", rating: null, explanation: "Not enough documented evidence.", citations: [] }] }));
    vi.spyOn(assessmentProvider, "createAssessmentProvider").mockReturnValue({ model: "test-model", complete });
    const assessment = { id: "hiring", version: 1, criteria: [{ id: "tool", label: "Tool evidence", terms: ["ledger"] }] };

    async function everyoneElse() {
      const institution = browser("institution");
      return {
        memberJourney: await f.member.listJourney(),
        memberProfile: await f.member.getOwnProfile(),
        memberApi: (await call(f.db, browser("member"), "GET", "journey")).json,
        institutionProfile: await f.institution.getProfile("member"),
        institutionJourney: await f.institution.listJourney("member"),
        institutionApi: (await call(f.db, institution, "GET", "profiles/member")).json,
        search: await f.institution.searchProfiles({ query: "savings" }),
        searchApi: (await call(f.db, institution, "GET", "profiles?query=savings")).json,
        discovery: await f.institution.discoveryEvidence(),
        adminJourney: await f.admin.listJourney("member"),
        otherMentor: await f.mentor2.listMentorship(),
        otherMentorCount: await f.mentor2.countAwaitingConfirmation(),
        assessment: (await call(f.db, institution, "POST", "profiles/member/assessment", assessment)).json,
        attention: f.database.prepare("SELECT * FROM attention_item ORDER BY id").all(),
        journeys: f.database.prepare("SELECT * FROM communityJourney ORDER BY id").all(),
        confirmations: f.database.prepare("SELECT * FROM communityConfirmation ORDER BY id").all(),
      };
    }
    const before = await everyoneElse();
    const prompts = complete.mock.calls.length;
    expect(prompts).toBe(1);
    expect((await call(f.db, browser("mentor"), "POST", `journey/${a.id}/set-aside`, { expectedRevision: 1 })).status).toBe(201);
    expect(await f.mentor.countAwaitingConfirmation()).toBe(0);
    const after = await everyoneElse();
    expect(after).toEqual(before);
    // The model saw exactly the same evidence.
    expect(complete.mock.calls[1]).toEqual(complete.mock.calls[0]);
    const { otherMentor, ...outsideMentoring } = after;
    expect(JSON.stringify(outsideMentoring)).not.toMatch(/set.?aside/i);
    expect(otherMentor.map((entry) => entry.setAsideByCurrentMentor)).toEqual([false]);
    expect(after.search).toHaveLength(1);
    expect(after.searchApi.profiles).toHaveLength(1);
  });

  it("is read and written only by the mentor's own Confirm page code", () => {
    // A new reader of the table must be added here on purpose, with a privacy test of its own.
    const root = new URL("../../", import.meta.url).pathname;
    const sources: string[] = [];
    const walk = (dir: string) => {
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        const path = join(dir, entry.name);
        if (entry.isDirectory()) walk(path);
        else if (/\.(ts|tsx|astro|mjs|sql)$/.test(entry.name) && !/\.test\.tsx?$/.test(entry.name)) sources.push(path);
      }
    };
    walk(root);
    const using = (pattern: RegExp) => sources.filter((path) => pattern.test(readFileSync(path, "utf8"))).map((path) => relative(root, path)).toSorted();
    expect(using(/communitySetAside/)).toEqual(["lib/community/service.ts", "lib/db/migrations/0027_mentor_set_aside.sql", "lib/db/schema.ts"]);
    expect(readFileSync(join(root, "lib/community/service.ts"), "utf8").match(/communitySetAside/g)).toHaveLength(4);
    expect(using(/setAsideByCurrentMentor/)).toEqual(["components/community/community-client.ts", "lib/community/service.ts"]);
  });
});

describe("set-aside HTTP", () => {
  it("does not exist while spaces is off for the caller", async () => {
    const f = setup();
    const a = await f.member.createJourney(contribution);
    for (const method of ["POST", "DELETE"]) {
      expect(await call(f.db, browser("mentor"), method, `journey/${a.id}/set-aside`, method === "POST" ? { expectedRevision: 1 } : undefined, OFF))
        .toEqual({ status: 404, json: { error: "Route not found." } });
    }
    // STAFF reaches admins only, as the spaces Confirm page does.
    f.database.prepare(`UPDATE feature_flag SET audience='STAFF' WHERE key='spaces'`).run();
    expect((await call(f.db, browser("mentor"), "POST", `journey/${a.id}/set-aside`, { expectedRevision: 1 }, OFF)).status).toBe(404);
    expect((await call(f.db, browser("admin"), "POST", `journey/${a.id}/set-aside`, { expectedRevision: 1 }, OFF)).status).toBe(201);
    expect(setAsideRows(f)).toEqual([{ mentorId: "admin", journeyId: a.id, journeyVersion: 1 }]);
  });

  it("sets aside and undoes from a same-origin browser session, and lists it only to that mentor", async () => {
    const f = setup();
    const a = await f.member.createJourney(contribution);
    const path = `journey/${a.id}/set-aside`;
    expect(await call(f.db, browser("mentor"), "POST", path, { expectedRevision: 1 })).toEqual({ status: 201, json: { setAside: { journeyId: a.id, journeyVersion: 1, setAside: true } } });
    const mine = await call(f.db, browser("mentor"), "GET", "mentorship");
    expect(mine.json.entries).toEqual([expect.objectContaining({ id: a.id, setAsideByCurrentMentor: true, reviewedByCurrentMentor: false })]);
    const theirs = await call(f.db, browser("mentor2"), "GET", "mentorship");
    expect(theirs.json.entries).toEqual([expect.objectContaining({ id: a.id, setAsideByCurrentMentor: false })]);
    expect(await call(f.db, browser("mentor"), "DELETE", path)).toEqual({ status: 200, json: { setAside: { journeyId: a.id, setAside: false } } });
    expect(setAsideRows(f)).toEqual([]);
    expect((await call(f.db, browser("mentor"), "GET", path)).status).toBe(404);
    expect((await call(f.db, browser("mentor"), "PUT", path, { expectedRevision: 1 })).status).toBe(404);
  });

  it("follows the browser rules of confirming: no tokens, delegated agents or cross-origin writes", async () => {
    const f = setup();
    const a = await f.member.createJourney(contribution);
    const path = `journey/${a.id}/set-aside`;
    const refused: [string, CommunityActor, string?][] = [
      ["a personal access token with write scope", { id: "mentor", scopes: ["community:read", "community:write"] }],
      ["a delegated agent session", { id: "mentor", scopes: null, delegatedSession: true }],
      ["a cross-origin browser request", browser("mentor"), "https://evil.example"],
      ["a member", browser("member")],
      ["an institution", browser("institution")],
    ];
    for (const [, actor, origin] of refused) {
      for (const method of ["POST", "DELETE"]) {
        const response = await call(f.db, actor, method, path, method === "POST" ? { expectedRevision: 1 } : undefined, ON, origin);
        expect(response.status).toBe(403);
      }
    }
    expect(setAsideRows(f)).toEqual([]);
    expect((await call(f.db, browser("mentor"), "POST", path, { expectedRevision: 1, extra: true })).status).toBe(400);
  });
});
