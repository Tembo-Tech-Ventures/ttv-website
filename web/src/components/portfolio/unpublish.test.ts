import { readdirSync } from "node:fs";
import type { DatabaseSync } from "node:sqlite";
import { drizzle } from "drizzle-orm/d1";
import { afterEach, describe, expect, it } from "vitest";
import * as schema from "@/lib/db/schema";
import { createSqliteD1, readMigration } from "@/test/sqlite-d1";
import { listPublicPosts, listPublicProfiles } from "@/lib/blog/public";
import { loadHomepageBuilders } from "@/lib/homepage/builders";
import { memberEligibility, publicProfileEligibility } from "@/lib/community/eligibility";
import { publishProfile, unpublishProfile } from "./portfolio-handlers";

/*
 * Taking yourself off the public website (PR D, coordinator decision): PUBLISHED back to DRAFT by the
 * owner, on SQLite with every migration. Everything public follows the listing, the profile stays in
 * the signed-in directory, and listing again through publishProfile brings back the same addresses.
 */
const databases: DatabaseSync[] = [];
afterEach(() => databases.splice(0).forEach((database) => database.close()));

function seeded(status: "DRAFT" | "PUBLISHED" | "SUSPENDED" = "PUBLISHED") {
  const { database, db } = createSqliteD1();
  databases.push(database);
  for (const file of readdirSync(new URL("../../lib/db/migrations/", import.meta.url)).filter((name) => name.endsWith(".sql")).toSorted()) {
    database.exec(readMigration(file));
  }
  database.exec(`INSERT INTO curriculum(id,title,description) VALUES ('curriculum','Fictional curriculum','Test');
    INSERT INTO program(id,name,description,curriculumId,startDate,endDate) VALUES ('cohort-04','Cohort 04','Test','curriculum',0,1);
    INSERT INTO user(id,name,email) VALUES ('achieng','Achieng Otieno','achieng@example.test'),('kevin','Kevin Omondi','kevin@example.test');
    INSERT INTO programApplication(id,userId,programId,status,application,completedAt) VALUES ('done','achieng','cohort-04','COMPLETED','{}',1780272000);
    INSERT INTO studentProfile(id,userId,handle,status,headline,publicName,publishedAt) VALUES
      ('profile','achieng','achieng-otieno','${status}','Backend builder','Achieng Otieno',1781000000);
    INSERT INTO blogPost(id,profileId,slug,title,contentMarkdown,status,publishedAt) VALUES
      ('post','profile','ledger-notes','Ledger notes','Fictional.','PUBLISHED',1781100000);`);
  return { database, db: drizzle(db, { schema }) };
}

const status = (database: DatabaseSync) =>
  (database.prepare("SELECT status, handle FROM studentProfile WHERE id='profile'").get() as { status: string; handle: string });
const flags = (database: DatabaseSync) => database.prepare(`SELECT ${publicProfileEligibility("p")} AS onPublicSite,
  ${memberEligibility("p.userId")} AS listed FROM studentProfile p WHERE p.id='profile'`).get() as { onPublicSite: number; listed: number };
const pass = async () => ({ outcome: "pass" as const, flags: [], scores: {} });

describe("taking a profile off the public website", () => {
  it("takes the page and the posts off everything public, and keeps the member in the directory", async () => {
    const { database, db } = seeded();
    expect((await listPublicProfiles(db)).map((profile) => profile.handle)).toEqual(["achieng-otieno"]);
    expect((await listPublicPosts(db)).map((post) => post.slug)).toEqual(["ledger-notes"]);

    expect(await unpublishProfile(db, "achieng", "profile")).toEqual({ success: true, published: false });

    expect(status(database)).toEqual({ status: "DRAFT", handle: "achieng-otieno" });
    expect(flags(database)).toEqual({ onPublicSite: 0, listed: 1 });
    // /talent, the sitemap and post pages read these; the homepage reads its own builders.
    expect(await listPublicProfiles(db)).toEqual([]);
    expect(await listPublicPosts(db)).toEqual([]);
    expect(await loadHomepageBuilders(db)).toEqual([]);
    // The post itself is kept, published, for when the profile is listed again.
    expect(database.prepare("SELECT status FROM blogPost WHERE id='post'").get()).toEqual({ status: "PUBLISHED" });
  });

  it("brings the same addresses back when the graduate lists it again", async () => {
    const { database, db } = seeded();
    await unpublishProfile(db, "achieng", "profile");
    expect(await publishProfile(db, "achieng", "profile", pass)).toMatchObject({ success: true, published: true });
    expect(status(database)).toEqual({ status: "PUBLISHED", handle: "achieng-otieno" });
    expect((await listPublicPosts(db)).map((post) => post.slug)).toEqual(["ledger-notes"]);
  });

  it("changes only the owner's own listed profile: never a draft, a paused one or someone else's", async () => {
    for (const state of ["DRAFT", "SUSPENDED"] as const) {
      const { database, db } = seeded(state);
      expect(await unpublishProfile(db, "achieng", "profile")).toEqual({ success: false, error: "Your profile isn't on the public website." });
      expect(status(database).status).toBe(state);
    }
    const { database, db } = seeded();
    expect(await unpublishProfile(db, "kevin", "profile")).toMatchObject({ success: false });
    expect(status(database).status).toBe("PUBLISHED");
  });
});
