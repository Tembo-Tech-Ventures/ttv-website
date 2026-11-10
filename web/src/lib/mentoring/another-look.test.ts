import { afterEach, describe, expect, it, vi } from "vitest";
import { VIEWER } from "@/lib/channels/test-support";
import { createCommunityService } from "@/lib/community/service";
import { ErrorEnvelope, WORTH_ANOTHER_LOOK_LIMIT, WorthAnotherLook } from "@/lib/platform/contracts";
import { mentoringDatabase, PEOPLE, type MentoringFixture } from "./test-support";

vi.mock("@/lib/observability/errors", async (importOriginal) => ({
  ...await importOriginal<typeof import("@/lib/observability/errors")>(),
  recordErrorInBackground: vi.fn(),
}));

const fixtures: MentoringFixture[] = [];
afterEach(() => { fixtures.splice(0).forEach(({ database }) => database.close()); vi.restoreAllMocks(); });
/** Flags as production reads them: from the database, no preview override. */
const DATABASE_FLAGS = { PLATFORM_FLAGS_OVERRIDE: undefined, DEPLOYMENT_ENVIRONMENT: "production" };

/** Wanjiku's ledger, which David confirmed at revision 2 and she has since moved to revision 3. */
function setup() {
  const s = mentoringDatabase();
  fixtures.push(s);
  s.project("ledger", { version: 3, title: "Chama ledger" });
  const confirm = (journeyId: string, mentorId: string, version: number) => s.database.prepare(`INSERT INTO communityConfirmation
      (id, journeyId, mentorId, statement, method, journeyVersion) VALUES (?, ?, ?, 'Reviewed it with them.', 'Code review', ?)`)
    .run(`confirm-${journeyId}-${mentorId}-${version}`, journeyId, mentorId, version);
  confirm("ledger", PEOPLE.david, 1);
  confirm("ledger", PEOPLE.david, 2);
  const look = async (user: string = PEOPLE.david, options: Parameters<MentoringFixture["call"]>[1] = {}) => {
    const response = await s.call("getWorthAnotherLook", { user, ...options });
    return { status: response.status, body: response.body };
  };
  const items = async (user: string = PEOPLE.david) => WorthAnotherLook.parse((await look(user)).body).items;
  /** The ids the Confirm page lists for `user`, where every item's link sends them. */
  const confirmPage = async (user: string = PEOPLE.david) =>
    (await createCommunityService(s.d1, user).listMentorship()).map((entry) => entry.id);
  return { s, confirm, look, items, confirmPage };
}

describe("Worth another look (B-4.2)", () => {
  it("lists the mentor's confirmed work that has moved on, with the revisions either side", async () => {
    const { items } = setup();
    expect(await items()).toEqual([{
      journeyId: "ledger", title: "Chama ledger", confirmedVersion: 2, currentVersion: 3, href: "/dashboard/mentoring/confirm",
      owner: { id: VIEWER, name: "Wanjiku Njeri", avatarUrl: null, roleBadges: [] },
    }]);
  });

  it("lists only work the Confirm page shows, so every item can be confirmed or set aside where its link goes", async () => {
    const t = setup();
    expect(await t.confirmPage()).toContain("ledger");
    // Fifty newer shared contributions push the ledger out of the Confirm page's window.
    t.s.database.prepare("UPDATE communityJourney SET createdAt = 1 WHERE id = 'ledger'").run();
    for (let i = 0; i < 50; i += 1) {
      t.s.project(`newer-${String(i).padStart(2, "0")}`);
      t.s.database.prepare("UPDATE communityJourney SET createdAt = ? WHERE id = ?").run(1_000 + i, `newer-${String(i).padStart(2, "0")}`);
    }
    expect(await t.confirmPage()).not.toContain("ledger");
    expect(await t.items()).toEqual([]);
    // One fewer, and it is back on both.
    t.s.database.prepare("DELETE FROM communityJourney WHERE id = 'newer-00'").run();
    expect(await t.confirmPage()).toContain("ledger");
    expect((await t.items()).map((item) => item.journeyId)).toEqual(["ledger"]);
  });

  it("drops work once the mentor confirms or sets aside its current revision, or it stops being shared", async () => {
    for (const change of [
      (t: ReturnType<typeof setup>) => t.confirm("ledger", PEOPLE.david, 3),
      (t: ReturnType<typeof setup>) => t.s.database.exec(`INSERT INTO communitySetAside(mentorId, journeyId, journeyVersion) VALUES ('${PEOPLE.david}', 'ledger', 3)`),
      (t: ReturnType<typeof setup>) => t.s.database.exec("UPDATE communityJourney SET state = 'DRAFT' WHERE id = 'ledger'"),
      (t: ReturnType<typeof setup>) => t.s.database.exec("DELETE FROM communityJourney WHERE id = 'ledger'"),
    ]) {
      const t = setup();
      change(t);
      expect(await t.items()).toEqual([]);
    }
  });

  it("keeps work set aside at an older revision, and ignores other mentors' confirmations", async () => {
    const t = setup();
    t.s.database.exec(`INSERT INTO communitySetAside(mentorId, journeyId, journeyVersion) VALUES ('${PEOPLE.david}', 'ledger', 2)`);
    t.confirm("ledger", PEOPLE.mercy, 3);
    expect((await t.items()).map((item) => item.journeyId)).toEqual(["ledger"]);
    expect(await t.items(PEOPLE.mercy)).toEqual([]);
    expect(await t.items(PEOPLE.joseph)).toEqual([]);
  });

  it("reads only the caller's own set-asides: another mentor's never hides or shows anything", async () => {
    const t = setup();
    t.s.database.exec(`INSERT INTO communitySetAside(mentorId, journeyId, journeyVersion) VALUES ('${PEOPLE.mercy}', 'ledger', 3)`);
    expect((await t.items()).map((item) => item.journeyId)).toEqual(["ledger"]);
    expect(await t.items(PEOPLE.mercy)).toEqual([]);
    // Nothing about a set-aside reaches the list: the item is the same with or without one.
    const t2 = setup();
    expect(await t2.items()).toEqual(await t.items());
  });

  it("never lists the mentor's own work", async () => {
    const t = setup();
    t.s.project("own", { owner: PEOPLE.david, version: 2 });
    t.confirm("own", PEOPLE.david, 1);
    expect((await t.items()).map((item) => item.journeyId)).toEqual(["ledger"]);
  });

  it(`lists at most ${WORTH_ANOTHER_LOOK_LIMIT}, the most recently changed first`, async () => {
    const t = setup();
    for (let i = 0; i < WORTH_ANOTHER_LOOK_LIMIT + 2; i += 1) {
      t.s.project(`work-${i}`, { version: 2 });
      t.s.database.prepare("UPDATE communityJourney SET updatedAt = ? WHERE id = ?").run(100 + i, `work-${i}`);
      t.confirm(`work-${i}`, PEOPLE.david, 1);
    }
    const listed = (await t.items()).map((item) => item.journeyId);
    expect(listed).toHaveLength(WORTH_ANOTHER_LOOK_LIMIT);
    expect(listed[0]).toBe(`work-${WORTH_ANOTHER_LOOK_LIMIT + 1}`);
    const confirmable = await t.confirmPage();
    expect(listed.filter((id) => !confirmable.includes(id))).toEqual([]);
  });

  it("is for mentors and admins, as the Confirm page is", async () => {
    const t = setup();
    for (const user of [VIEWER, PEOPLE.amani, "synthetic-otieno"]) {
      const { status, body } = await t.look(user);
      expect([status, ErrorEnvelope.parse(body).error.code], `${user}`).toEqual([403, "forbidden"]);
    }
    expect((await t.look(PEOPLE.amina)).status).toBe(200);
  });

  it("is 404 while mentor_requests is off for the caller, and refuses tokens and delegated agent sessions", async () => {
    const t = setup();
    t.s.database.exec("UPDATE feature_flag SET audience = 'OFF' WHERE key = 'mentor_requests'");
    const off = await t.look(PEOPLE.david, { env: DATABASE_FLAGS });
    expect([off.status, ErrorEnvelope.parse(off.body).error.code]).toEqual([404, "flag_off"]);
    expect((await t.look(PEOPLE.david, { locals: { personalAccessToken: { id: "pat", scopes: ["admin:read"] } } as never })).status).toBe(403);
    expect((await t.look(PEOPLE.david, { locals: { session: { userAgent: "ttv-agent:synthetic" } } as never })).status).toBe(403);
  });
});
