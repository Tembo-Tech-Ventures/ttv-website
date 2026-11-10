import { fairSort } from "@/components/talent/directory-helpers";
import { describe, expectTypeOf, it } from "vitest";
import {
  listMembers,
  readMember,
  readOwnMemberCard,
  type MemberCard,
  type MemberPage,
  type MemberProfileView,
} from "./directory";

describe("member directory UI contract", () => {
  it("exposes paginated cards and nullable profile reads", () => {
    expectTypeOf(readOwnMemberCard).returns.toEqualTypeOf<
      Promise<MemberCard | null>
    >();
    expectTypeOf(listMembers).returns.toEqualTypeOf<Promise<MemberPage>>();
    expectTypeOf(readMember).returns.toEqualTypeOf<
      Promise<MemberProfileView | null>
    >();
  });
});

import { readdirSync } from "node:fs";
import { afterEach, expect, vi } from "vitest";
import { createSqliteD1, readMigration } from "@/test/sqlite-d1";
const databases: ReturnType<typeof createSqliteD1>["database"][] = [];
afterEach(() => {
  databases.splice(0).forEach((db) => db.close());
});
function world() {
  const { db, database } = createSqliteD1();
  databases.push(database);
  for (const file of readdirSync(new URL("../db/migrations/", import.meta.url))
    .filter((n) => /^\d+.*\.sql$/.test(n))
    .toSorted())
    database.exec(readMigration(file));
  for (let i = 0; i < 30; i++) {
    const id = `member-${String(i).padStart(2, "0")}`;
    database
      .prepare(
        "INSERT INTO user(id,name,email) VALUES (?, 'Synthetic Wanjiku', ?)",
      )
      .run(id, `${id}@example.test`);
    database
      .prepare(
        "INSERT INTO studentProfile(id,userId,handle,publicName,headline,skills,openToRoles) VALUES (?,?,?,'Synthetic Wanjiku','Builder','[\"Rust\"]',1)",
      )
      .run(id, id, id);
  }
  database.exec(`
    UPDATE studentProfile SET moderationOutcome='hold' WHERE userId='member-01';
    UPDATE studentProfile SET status='SUSPENDED' WHERE userId='member-02';
    INSERT INTO UserRoles(id,userId,roleId) SELECT 'mentor-role','member-03',id FROM Roles WHERE name='MENTOR';
    INSERT INTO communityJourney(id,userId,title,description,occurredAt,visibility,state) VALUES
      ('posted','member-00','Posted','Public evidence','2026-11-09','institution','POSTED'),
      ('draft','member-00','Draft','Private evidence','2026-11-09','institution','DRAFT'),
      ('held','member-00','Held','Held evidence','2026-11-09','institution','POSTED');
    UPDATE communityJourney SET moderationOutcome='hold' WHERE id='held';
    INSERT INTO communityConfirmation(id,journeyId,mentorId,statement,method,journeyVersion) VALUES
      ('confirmation','posted','member-03','Reviewed the work','Code review',1);
  `);
  return { db, database };
}
const caller = { id: "member-29", isAdmin: false };
describe("directory eligibility and bounded reads", () => {
  it("paginates all eligible profiles in daily order, with stable totals and one batch", async () => {
    const { db } = world();
    const batch = vi.spyOn(db, "batch");
    const first = await listMembers(db, caller, {
      skills: ["Rust"],
      openTo: "roles",
    });
    expect(batch).toHaveBeenCalledTimes(1);
    expect(first.total).toBe(26);
    expect(first.members).toHaveLength(24);
    const second = await listMembers(db, caller, { cursor: first.nextCursor! });
    expect(second.members).toHaveLength(2);
    expect(second.nextCursor).toBeNull();
    expect(second.total).toBe(26);
    expect(
      new Set([...first.members, ...second.members].map((m) => m.handle)).size,
    ).toBe(26);
    expect(
      [...first.members, ...second.members].find(
        (m) => m.handle === "member-00",
      ),
    ).toMatchObject({
      postedWorkCount: 1,
      confirmedWorkCount: 1,
      onPublicSite: false,
    });
  });
  it("pins fairSort order across Nairobi midnight and returns a separate own card", async () => {
    vi.useFakeTimers();
    try {
      vi.setSystemTime(new Date("2026-11-09T20:59:59Z"));
      const { db } = world();
      const first = await listMembers(db, caller);
      const rest = await listMembers(db, caller, { cursor: first.nextCursor! });
      const ids = Array.from(
        { length: 30 },
        (_, i) => `member-${String(i).padStart(2, "0")}`,
      ).filter(
        (id) =>
          !["member-01", "member-02", "member-03", caller.id].includes(id),
      );
      expect([...first.members, ...rest.members].map((m) => m.handle)).toEqual(
        fairSort(
          ids.map((id) => ({ id })),
          "2026-11-09",
        ).map((p) => p.id),
      );
      vi.setSystemTime(new Date("2026-11-09T21:00:01Z"));
      expect(
        await listMembers(db, caller, { cursor: first.nextCursor! }),
      ).toEqual(rest);
      expect((await readOwnMemberCard(db, caller))?.handle).toBe(caller.id);
      expect(
        await readOwnMemberCard(db, { id: "member-01", isAdmin: false }),
      ).toBeNull();
      expect(
        [...first.members, ...rest.members].map((m) => m.handle),
      ).not.toContain(caller.id);
    } finally {
      vi.useRealTimers();
    }
  });
  it("searches all text fields, clamps input and matches every exact skill case-insensitively", async () => {
    const { db, database } = world();
    database.exec(
      "UPDATE studentProfile SET opportunityGoals='Paid research',skills='[\"Rust\",\"SQL\"]' WHERE userId='member-00'",
    );
    expect(
      (
        await listMembers(db, caller, {
          q: "RESEARCH",
          skills: ["rust", "sql"],
        })
      ).members.map((m) => m.handle),
    ).toEqual(["member-00"]);
    expect((await listMembers(db, caller, { skills: ["Ru"] })).total).toBe(0);
    expect(
      await listMembers(db, caller, {
        q: "x".repeat(101),
        skills: Array(6).fill("SQL"),
      }),
    ).toEqual(
      await listMembers(db, caller, {
        q: "x".repeat(100),
        skills: Array(5).fill("SQL"),
      }),
    );
  });
  it("uses the same list for admins and ordinary signed-in callers", async () => {
    const { db } = world();
    expect(await listMembers(db, { ...caller, isAdmin: true })).toEqual(
      await listMembers(db, caller),
    );
    expect(await readMember(db, caller, "member-01")).toBeNull();
    expect(await readMember(db, caller, "unknown")).toBeNull();
    expect(
      await readMember(db, { id: "member-01", isAdmin: false }, "member-01"),
    ).toBeNull();
    expect(
      await readMember(db, { ...caller, isAdmin: true }, "member-01"),
    ).toBeNull();
  });
  it("hides held work and drafts from other readers, and marks current confirmations", async () => {
    const { db } = world();
    const batch = vi.spyOn(db, "batch");
    const profile = await readMember(db, caller, "member-00");
    expect(batch).toHaveBeenCalledTimes(1);
    expect(profile?.work.map((w) => w.id)).toEqual(["posted"]);
    expect(profile?.work[0].confirmations[0]).toMatchObject({
      isCurrentRevision: true,
      revision: 1,
    });
    expect(profile?.publicUrl).toBeNull();
    expect(
      (await readMember(db, { id: "member-00", isAdmin: false }, "member-00"))
        ?.work,
    ).toHaveLength(1);
  });
  it("refuses anonymous reads and malformed cursors", async () => {
    const { db } = world();
    await expect(
      listMembers(db, { id: "", isAdmin: false }),
    ).rejects.toMatchObject({ status: 401 });
    await expect(
      readMember(db, { id: "", isAdmin: false }, "member-00"),
    ).rejects.toMatchObject({ status: 401 });
    expect(await listMembers(db, caller, { cursor: "not base64" })).toEqual(
      await listMembers(db, caller),
    );
  });
});
