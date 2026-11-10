import { readdirSync } from "node:fs";
import { createSqliteD1, readMigration } from "@/test/sqlite-d1";
import { afterEach } from "vitest";
import { describe, expect, it } from "vitest";
import { drizzle } from "drizzle-orm/d1";
import * as schema from "@/lib/db/schema";
import {
  profileStateWithHighlights,
  replaceProfileHighlights,
  type HighlightProfileState,
  type ProfileHighlightValues,
} from "./profile-highlights";

const profile: HighlightProfileState = {
  id: "profile-1",
  userId: "user-1",
  status: "PUBLISHED",
  contentVersion: 8,
  handle: "builder",
  headline: "Developer",
  bio: "I build useful tools.",
  location: "Lagos",
  country: "Nigeria",
  skills: '["TypeScript"]',
  githubLogin: "builder",
  portfolioUrl: null,
  linkedinUrl: null,
  publicName: "Checked Builder",
  publicAvatarUrl: "/api/avatar/avatars/user-1/checked.webp",
  user: { name: "Mutable Name", image: null },
};

const highlight: ProfileHighlightValues = {
  repoFullName: "builder/project",
  repoUrl: "https://github.com/builder/project",
  description: "A useful project",
  language: "TypeScript",
  topics: '["web"]',
  stars: 3,
  pushedAt: new Date("2026-10-01T00:00:00Z"),
  blurb: "What I built",
  sortOrder: 0,
  snapshotAt: new Date("2026-10-10T00:00:00Z"),
};

const databases: ReturnType<typeof createSqliteD1>["database"][] = [];
afterEach(() => databases.splice(0).forEach((d) => d.close()));
function fixture() {
  const { db: client, database } = createSqliteD1();
  databases.push(database);
  for (const name of readdirSync(new URL("../db/migrations/", import.meta.url))
    .filter((n) => /^\d+.*\.sql$/.test(n))
    .toSorted())
    database.exec(readMigration(name));
  database.exec(`INSERT INTO user(id,name,email) VALUES ('user-1','Synthetic Wanjiku','wanjiku@example.test');
 INSERT INTO studentProfile(id,userId,handle,status,contentVersion) VALUES ('profile-1','user-1','builder','PUBLISHED',8);`);
  return { db: drizzle(client, { schema }), database };
}

describe("repository work writes", () => {
  it("includes snapshot text in moderation", () => {
    expect(
      profileStateWithHighlights(profile, ["TypeScript"], [highlight])
        .highlights?.[0],
    ).toMatchObject({ repoFullName: highlight.repoFullName, topics: ["web"] });
  });
  it("upserts in place, preserving confirmations and order, and makes deselected repos drafts", async () => {
    const { db, database } = fixture();
    expect(
      await replaceProfileHighlights(db, profile, [highlight]),
    ).toMatchObject({
      outcome: "saved",
    });
    const row = database.prepare("SELECT id FROM communityJourney").get() as {
      id: string;
    };
    database
      .prepare(
        "INSERT INTO communityConfirmation(id,journeyId,mentorId,statement,method,journeyVersion) VALUES ('confirm',?,'user-1','Reviewed','Code',1)",
      )
      .run(row.id);
    expect(
      await replaceProfileHighlights(db, { ...profile, contentVersion: 9 }, [
        { ...highlight, blurb: "New revision", sortOrder: 3 },
      ]),
    ).toMatchObject({ outcome: "saved" });
    expect(
      database
        .prepare(
          "SELECT id,sortOrder,version,description FROM communityJourney",
        )
        .get(),
    ).toEqual({
      id: row.id,
      sortOrder: 3,
      version: 2,
      description: "New revision",
    });
    expect(
      database.prepare("SELECT journeyId FROM communityConfirmation").get(),
    ).toEqual({ journeyId: row.id });
    await replaceProfileHighlights(db, { ...profile, contentVersion: 10 }, []);
    expect(
      database.prepare("SELECT state FROM communityJourney").get(),
    ).toEqual({ state: "DRAFT" });
    expect(
      database.prepare("SELECT count(*) n FROM communityConfirmation").get(),
    ).toEqual({ n: 1 });
  });
  it("queues checks before screening and preserves holds and human hides", async () => {
    const { db, database } = fixture();
    await replaceProfileHighlights(db, profile, [highlight]);
    expect(
      database
        .prepare(
          "SELECT moderationOutcome,moderationReviewRequired FROM communityJourney",
        )
        .get(),
    ).toEqual({ moderationOutcome: null, moderationReviewRequired: 1 });
    database.exec(
      "UPDATE communityJourney SET state='DRAFT',moderatorHidden=1,moderationOutcome='hold'",
    );
    await replaceProfileHighlights(db, { ...profile, contentVersion: 9 }, [
      highlight,
    ]);
    expect(
      database
        .prepare(
          "SELECT state,moderatorHidden,moderationOutcome FROM communityJourney",
        )
        .get(),
    ).toEqual({
      state: "DRAFT",
      moderatorHidden: 1,
      moderationOutcome: "hold",
    });
  });
  it("preserves confirmation currency on reorder and snapshot refresh", async () => {
    const { db, database } = fixture();
    await replaceProfileHighlights(db, profile, [highlight]);
    const row = database.prepare("SELECT id FROM communityJourney").get() as {
      id: string;
    };
    database
      .prepare(
        "INSERT INTO communityConfirmation(id,journeyId,mentorId,statement,method,journeyVersion) VALUES ('confirm',?,'user-1','Reviewed','Code',1)",
      )
      .run(row.id);
    await replaceProfileHighlights(db, { ...profile, contentVersion: 9 }, [
      { ...highlight, sortOrder: 2, stars: 99, snapshotAt: new Date() },
    ]);
    expect(
      database
        .prepare("SELECT version,sortOrder,stars FROM communityJourney")
        .get(),
    ).toEqual({ version: 1, sortOrder: 2, stars: 99 });
    expect(
      database
        .prepare(
          "SELECT count(*) n FROM communityConfirmation c JOIN communityJourney w ON c.journeyId=w.id AND c.journeyVersion=w.version",
        )
        .get(),
    ).toEqual({ n: 1 });
  });
  it("refuses stale and suspended writes without changing work", async () => {
    const { db, database } = fixture();
    expect(
      await replaceProfileHighlights(db, { ...profile, contentVersion: 7 }, [
        highlight,
      ]),
    ).toEqual({ outcome: "conflict" });
    expect(
      await replaceProfileHighlights(db, { ...profile, status: "SUSPENDED" }, [
        highlight,
      ]),
    ).toEqual({ outcome: "suspended" });
    expect(
      database.prepare("SELECT count(*) n FROM communityJourney").get(),
    ).toEqual({ n: 0 });
  });
});

it("reposts an author draft only after an explicit picker selection", async () => {
  const { db, database } = fixture();
  await replaceProfileHighlights(db, profile, [highlight]);
  database.exec("UPDATE communityJourney SET state='DRAFT'");
  await replaceProfileHighlights(
    db,
    { ...profile, contentVersion: 9 },
    [highlight],
    true,
  );
  expect(database.prepare("SELECT state FROM communityJourney").get()).toEqual({
    state: "POSTED",
  });
  database.exec("UPDATE communityJourney SET state='DRAFT',moderatorHidden=1");
  await replaceProfileHighlights(
    db,
    { ...profile, contentVersion: 10 },
    [highlight],
    true,
  );
  expect(database.prepare("SELECT state FROM communityJourney").get()).toEqual({
    state: "DRAFT",
  });
});

it("reorders preserve holds and keeps, and deletion cannot erase a hidden repository tombstone", async () => {
  const { db, database } = fixture();
  await replaceProfileHighlights(db, profile, [highlight], true);
  database.exec(
    "UPDATE communityJourney SET moderationOutcome='hold',moderationCheckedAt=123,moderationReviewRequired=1",
  );
  const reordered = await replaceProfileHighlights(
    db,
    { ...profile, contentVersion: 9 },
    [{ ...highlight, sortOrder: 1 }],
    true,
  );
  expect(reordered).toMatchObject({ outcome: "saved", revisions: [] });
  expect(
    database
      .prepare(
        "SELECT version,moderationOutcome,moderationCheckedAt FROM communityJourney",
      )
      .get(),
  ).toEqual({
    version: 1,
    moderationOutcome: "hold",
    moderationCheckedAt: 123,
  });
  database.exec(
    "UPDATE communityJourney SET moderationOutcome='pass',moderationReviewRequired=0",
  );
  await replaceProfileHighlights(
    db,
    { ...profile, contentVersion: 10 },
    [highlight],
    true,
  );
  expect(
    database
      .prepare(
        "SELECT moderationOutcome,moderationReviewRequired FROM communityJourney",
      )
      .get(),
  ).toEqual({ moderationOutcome: "pass", moderationReviewRequired: 0 });
  database.exec(
    "UPDATE communityJourney SET moderatorHidden=1,state='DRAFT',moderationOutcome='hold'",
  );
  const { createCommunityService } = await import("@/lib/community/service");
  const raw = (db as unknown as { $client: D1Database }).$client;
  const service = createCommunityService(
    raw,
    "user-1",
    undefined,
    undefined,
    undefined,
    {} as Env,
  );
  const row = database.prepare("SELECT id FROM communityJourney").get() as {
    id: string;
  };
  await service.deleteJourney(row.id);
  await replaceProfileHighlights(
    db,
    { ...profile, contentVersion: 11 },
    [highlight],
    true,
  );
  expect(
    database
      .prepare("SELECT id,state,moderatorHidden FROM communityJourney")
      .get(),
  ).toEqual({ id: row.id, state: "DRAFT", moderatorHidden: 1 });
});
