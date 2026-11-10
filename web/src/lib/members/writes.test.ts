import { drizzle } from "drizzle-orm/d1";
import * as schema from "@/lib/db/schema";
import { saveProfileIdentity } from "@/components/profile/profile-handlers";
import {
  saveProfile,
  publishProfile,
} from "@/components/portfolio/portfolio-handlers";
import { readdirSync } from "node:fs";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createSqliteD1, readMigration } from "@/test/sqlite-d1";
import { saveMemberText, checkPostedWork } from "./writes";
import { reviewWork } from "./moderation";
import { readMember } from "./directory";
import * as clef from "@/lib/moderation/clef";
const databases: ReturnType<typeof createSqliteD1>["database"][] = [];
afterEach(() => {
  vi.restoreAllMocks();
  databases.splice(0).forEach((d) => d.close());
});
function fixture() {
  const f = createSqliteD1();
  databases.push(f.database);
  for (const name of readdirSync(new URL("../db/migrations/", import.meta.url))
    .filter((n) => /^\d+.*\.sql$/.test(n))
    .toSorted())
    f.database.exec(readMigration(name));
  f.database
    .exec(`INSERT INTO user(id,name,email) VALUES ('member','Synthetic Wanjiku','w@example.test'),('admin','Synthetic Amina','a@example.test');
 INSERT OR IGNORE INTO Roles(id,name) VALUES ('admin-role','ADMIN');
 INSERT INTO UserRoles(id,userId,roleId) SELECT 'admin-grant','admin',id FROM Roles WHERE name='ADMIN';`);
  return f;
}
const text = {
  headline: "Builder",
  bio: "Useful work",
  skills: ["SQL"],
  opportunityGoals: "Collaborate",
};
const env = { AI: {} as Ai, AI_GATEWAY_NAME: "test" };
describe("member publish-then-check", () => {
  it("lets a non-graduate use the portfolio write path but refuses public publication", async () => {
    const { db, database } = fixture();
    const orm = drizzle(db, { schema });
    const form = new FormData();
    form.set("handle", "wanjiku");
    form.set("headline", "Builder");
    form.set("opportunityGoals", "Collaborate");
    form.set("openToRoles", "on");
    expect(
      await saveProfile(orm, "member", form, undefined, async () => ({
        outcome: "pass",
        flags: [],
        scores: {},
      })),
    ).toMatchObject({ success: true });
    const row = database
      .prepare(
        "SELECT id,opportunityGoals,openToRoles FROM studentProfile WHERE userId='member'",
      )
      .get() as { id: string };
    expect(row).toMatchObject({
      opportunityGoals: "Collaborate",
      openToRoles: 1,
    });
    expect(await publishProfile(orm, "member", row.id)).toMatchObject({
      success: false,
      error: expect.stringContaining("Complete a cohort"),
    });
    expect(database.prepare("SELECT status FROM studentProfile").get()).toEqual(
      { status: "DRAFT" },
    );
  });
  it("saves a single profile, generates distinct valid handles, and fails open", async () => {
    const { db, database } = fixture();
    await saveMemberText(db, "member", text);
    await saveMemberText(db, "member", { ...text, headline: "Updated" });
    await saveMemberText(db, "admin", text);
    const rows = database
      .prepare(
        "SELECT handle,contentVersion,moderationOutcome FROM studentProfile ORDER BY userId",
      )
      .all() as {
      handle: string;
      contentVersion: number;
      moderationOutcome: string;
    }[];
    expect(rows).toHaveLength(2);
    expect(new Set(rows.map((r) => r.handle)).size).toBe(2);
    expect(rows[1]).toMatchObject({
      contentVersion: 2,
      moderationOutcome: "error",
    });
    expect(rows.map((r) => r.handle)).toEqual([
      "synthetic-amina",
      "synthetic-wanjiku",
    ]);
  });
  it("holds the saved profile from every directory reader, including its owner", async () => {
    const { db, database } = fixture();
    vi.spyOn(clef, "checkProfileContent").mockResolvedValue({
      outcome: "hold",
      flags: ["contains_contact_details"],
      scores: {},
    });
    await saveMemberText(db, "member", text, env);
    const { handle } = database
      .prepare("SELECT handle FROM studentProfile")
      .get() as { handle: string };
    expect(
      await readMember(db, { id: "member", isAdmin: false }, handle),
    ).toBeNull();
    expect(
      database
        .prepare("SELECT headline,moderationReviewRequired FROM studentProfile")
        .get(),
    ).toEqual({ headline: "Builder", moderationReviewRequired: 1 });
  });
  it("does not let a slow profile check overwrite a newer revision", async () => {
    const { db, database } = fixture();
    vi.spyOn(clef, "checkProfileContent").mockImplementation(async () => {
      database.exec(
        "UPDATE studentProfile SET contentVersion=contentVersion+1,moderationOutcome='pass'",
      );
      return { outcome: "hold", flags: [], scores: {} };
    });
    await saveMemberText(db, "member", text, env);
    expect(
      database.prepare("SELECT moderationOutcome FROM studentProfile").get(),
    ).toEqual({ moderationOutcome: "pass" });
  });
  it("lets only admins decide current work holds, preserving the work revision", async () => {
    const { db, database } = fixture();
    await saveMemberText(db, "member", text);
    database.exec(
      "INSERT INTO communityJourney(id,userId,title,description,occurredAt,visibility) VALUES ('work','member','Work','Evidence','2026-11-09','institution')",
    );
    vi.spyOn(clef, "checkProfileContent").mockResolvedValue({
      outcome: "hold",
      flags: [],
      scores: {},
    });
    await checkPostedWork(db, "work", env);
    await expect(
      reviewWork(db, "member", "work", 1, "keep"),
    ).rejects.toMatchObject({ status: 403 });
    expect(await reviewWork(db, "admin", "work", 2, "keep")).toBe(false);
    expect(await reviewWork(db, "admin", "work", 1, "keep")).toBe(true);
    expect(
      database
        .prepare(
          "SELECT version,state,moderationOutcome,moderationReviewRequired FROM communityJourney",
        )
        .get(),
    ).toEqual({
      version: 1,
      state: "POSTED",
      moderationOutcome: "pass",
      moderationReviewRequired: 0,
    });
  });
});

it("saves a published name before checking and holds exactly that revision", async () => {
  const { db, database } = fixture();
  await saveMemberText(db, "member", text);
  database.exec("UPDATE studentProfile SET status='PUBLISHED'");
  const orm = drizzle(db, { schema });
  await saveProfileIdentity(
    orm,
    "member",
    { name: "Changed Name" },
    async () => {
      expect(
        database.prepare("SELECT publicName FROM studentProfile").get(),
      ).toEqual({ publicName: "Changed Name" });
      return { outcome: "hold", flags: [], scores: {} };
    },
  );
  expect(
    database
      .prepare("SELECT publicName,moderationOutcome FROM studentProfile")
      .get(),
  ).toEqual({ publicName: "Changed Name", moderationOutcome: "hold" });
});

it("allocates readable handles across duplicate names, reserved names and empty slugs", async () => {
  const { db, database } = fixture();
  database.exec(
    "INSERT INTO user(id,name,email) VALUES ('same','Synthetic Wanjiku','same@example.test'),('reserved','Admin','reserved@example.test'),('symbols','!!!','symbols@example.test')",
  );
  await saveMemberText(db, "member", text);
  await saveMemberText(db, "same", text);
  await saveMemberText(db, "reserved", text);
  await saveMemberText(db, "symbols", text);
  expect(
    database.prepare("SELECT handle FROM studentProfile ORDER BY userId").all(),
  ).toEqual([
    { handle: "synthetic-wanjiku" },
    { handle: "admin-member" },
    { handle: "synthetic-wanjiku-2" },
    { handle: "member-1" },
  ]);
});
