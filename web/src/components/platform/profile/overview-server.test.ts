import { readdirSync } from "node:fs";
import { drizzle } from "drizzle-orm/d1";
import { afterEach, describe, expect, it, vi } from "vitest";
import * as schema from "@/lib/db/schema";
import type { StudentJourney } from "@/lib/student/journey";
import type { SpacePageContext } from "@/components/platform/spaces/space-page";
import { createSqliteD1, readMigration } from "@/test/sqlite-d1";

vi.mock("cloudflare:workers", () => ({ env: { DB: "synthetic-d1" } }));
const { opportunityFacts, profileOverviewFacts } = await import("./overview-server");

const databases: { close(): void }[] = [];
afterEach(() => databases.splice(0).forEach((database) => database.close()));

/** Every migration, one approved and one proposed project, and Achieng with a profile in `status`. */
function seeded(status: "DRAFT" | "PUBLISHED" | "SUSPENDED" | null) {
  const { database, db } = createSqliteD1();
  databases.push(database);
  for (const file of readdirSync(new URL("../../../lib/db/migrations/", import.meta.url)).filter((name) => name.endsWith(".sql")).toSorted()) {
    database.exec(readMigration(file));
  }
  database.exec(`INSERT INTO user(id,name,email) VALUES ('achieng','Achieng Otieno','achieng@example.test');
    INSERT INTO clientProject(id,organization,contactName,contactEmail,title,description,status,createdAt) VALUES
      ('savings','Chama Savings','Grace Wanjiru','grace@example.test','Member savings tracker','Fictional.','APPROVED',2),
      ('fees','Shule Bora','Baraka Mwangi','baraka@example.test','Fees reminder','Fictional.','APPROVED',1),
      ('proposed','Duka','Neema Ally','neema@example.test','Stock counts','Fictional.','PENDING',3);`);
  if (status) {
    database.exec(`INSERT INTO studentProfile(id,userId,handle,status) VALUES ('profile','achieng','achieng-otieno','${status}');
      INSERT INTO projectInterest(id,projectId,profileId,status) VALUES ('hand','fees','profile','INTERESTED');`);
  }
  return drizzle(db, { schema });
}

describe("opportunityFacts", () => {
  it("finds no project behind the page's own gate: no profile, a draft or a suspended one", async () => {
    for (const status of [null, "DRAFT", "SUSPENDED"] as const) {
      await expect(opportunityFacts(seeded(status), "achieng")).resolves.toEqual([]);
    }
  });

  it("lists approved projects, newest first, with the person's raised hands, once the profile is published", async () => {
    await expect(opportunityFacts(seeded("PUBLISHED"), "achieng")).resolves.toEqual([
      { id: "savings", title: "Member savings tracker", organization: "Chama Savings", interested: false },
      { id: "fees", title: "Fees reminder", organization: "Shule Bora", interested: true },
    ]);
  });

  it("reads another person's published profile as no gate at all", async () => {
    await expect(opportunityFacts(seeded("PUBLISHED"), "someone-else")).resolves.toEqual([]);
  });
});

const PROJECTS = [{ id: "savings", title: "Member savings tracker", organization: "Chama Savings", interested: false }];

function reads(linkIds: StudentJourney["visibleLinkIds"]) {
  return {
    journey: { state: "published", visibleLinkIds: linkIds, unreadLeadCount: 7, nextStep: null } as unknown as StudentJourney,
    own: {
      profile: {
        id: "profile", status: "PUBLISHED" as const, handle: "achieng-otieno", headline: null, bio: null, location: null, country: null,
        skills: '["Python"]', publicName: null, publicAvatarUrl: null,
      },
      leads: [{ id: "lead", fromName: "Grace Wanjiru", organization: "Chama Savings" }],
      drafts: [],
      opportunities: { gate: "published" as const, items: PROJECTS },
    },
    contributions: [],
    certificates: [],
  };
}

const CONTEXT = {
  me: { user: { id: "achieng", name: "Achieng Otieno", avatarUrl: null }, flags: { channels: true, mentor_requests: true } },
  onboarding: { framing: "builder" },
} as unknown as SpacePageContext;

describe("profileOverviewFacts", () => {
  it("takes eligibility and the unopened-message count from the journey the frame shares", () => {
    const facts = profileOverviewFacts(reads(["home", "profile", "opportunities", "leads"]), CONTEXT);
    expect(facts).toMatchObject({
      person: { id: "achieng", name: "Achieng Otieno", image: null },
      eligible: true,
      leads: { items: [{ id: "lead" }], total: 7 },
      opportunities: { gate: "published", items: PROJECTS },
      mentorRequests: true,
      framing: "builder",
    });
    expect(facts.profile?.skills).toEqual(["Python"]);
  });

  it("shows no project while the journey has not opened Opportunities, even if the profile read says published", () => {
    const facts = profileOverviewFacts(reads(["home", "leads"]), CONTEXT);
    expect(facts.eligible).toBe(false);
    expect(facts.opportunities).toEqual({ gate: "published", items: [] });
  });
});
