import { afterEach, describe, expect, it } from "vitest";
import type { SQLInputValue } from "node:sqlite";
import { Channel } from "@/lib/platform/contracts";
import { capabilitiesFor } from "@/lib/platform/server/capabilities";
import {
  accessFromLetters, CHANNEL_ACCESS_MATRIX, type CapabilityCase, type ChannelTarget,
} from "@/lib/platform/server/capabilities.fixtures";
import { createCapabilityDatabase } from "@/lib/platform/server/capabilities.test-support";
import { readMigration } from "@/test/sqlite-d1";
import { findReadableChannel, listChannelsFor } from "./access";

const fixtures: ReturnType<typeof createCapabilityDatabase>[] = [];
afterEach(() => { fixtures.splice(0).forEach(({ database }) => database.close()); });

/**
 * The capability fixture with migration 0028's real seeds (five community channels, three per
 * cohort), plus one channel of every other shape. Cohort B started after cohort A.
 */
function setup(fixture: Partial<CapabilityCase> = {}) {
  const result = createCapabilityDatabase(fixture);
  fixtures.push(result);
  const { database } = result;
  database.exec(readMigration("0021_feature_flags.sql"));
  database.exec(readMigration("0028_channels.sql"));
  database.exec(`UPDATE program SET startDate = 100 WHERE id = 'cohort-a'; UPDATE program SET startDate = 200 WHERE id = 'cohort-b';
    INSERT INTO channel (id, kind, programId, slug, name, postingPolicy, position, archivedAt) VALUES
      ('community-archived', 'COMMUNITY', NULL, 'old-lounge', 'old-lounge', 'ALL', 0, 5),
      ('community-staff', 'COMMUNITY', NULL, 'team-news', 'team-news', 'STAFF', 6, NULL),
      ('cohort-a-archived', 'COHORT', 'cohort-a', 'cohort-a-old', 'cohort-a-old', 'ALL', 0, 5),
      ('direct-member', 'DIRECT', NULL, 'portfolio-review', 'Portfolio review', 'ALL', 0, NULL),
      ('direct-other', 'DIRECT', NULL, 'portfolio-review', 'Portfolio review', 'ALL', 0, NULL);
    INSERT INTO channel_member (channelId, userId) VALUES ('direct-member', 'synthetic-wanjiku'), ('direct-other', 'synthetic-otieno');`);
  result.queries.length = 0;
  return result;
}

type Fixture = ReturnType<typeof setup>;
/** The query plan of the last statement the fixture's Drizzle issued, with its own parameters. */
const lastPlan = ({ database, queries, parameters }: Fixture) => database
  .prepare(`EXPLAIN QUERY PLAN ${queries.at(-1)}`).all(...(parameters.at(-1) as SQLInputValue[]))
  .map((row) => String(row.detail)).join("\n");
const slugOf = ({ database }: Fixture, seedKey: string) =>
  (database.prepare("SELECT slug FROM channel WHERE seedKey = ?").get(seedKey) as { slug: string }).slug;

/** Which CHANNEL_TARGETS shape each database channel is. */
function targetOf(row: { id: string; seedKey: string | null; postingPolicy: string; programId: string | null }): ChannelTarget {
  const extras: Record<string, ChannelTarget> = {
    "community-archived": "communityArchived", "community-staff": "communityStaff", "cohort-a-archived": "cohortAArchived",
    "direct-member": "directMember", "direct-other": "directOther",
  };
  if (extras[row.id]) return extras[row.id];
  if (row.programId === null) return "community";
  const cohort = row.programId === "cohort-a" ? "cohortA" : "cohortB";
  return row.postingPolicy === "STAFF" ? `${cohort}Announcements` : cohort;
}

describe("listChannelsFor", () => {
  it.each(CHANNEL_ACCESS_MATRIX)("lists exactly the channels $name can read, with their capabilities", async (fixture) => {
    const { database, db, user, queries } = setup(fixture);
    const all = database.prepare("SELECT id, seedKey, postingPolicy, programId FROM channel").all() as Parameters<typeof targetOf>[0][];
    const expected = all.flatMap((row) => {
      const { canRead, ...capabilities } = accessFromLetters(fixture.channels[targetOf(row)]);
      return canRead ? [{ id: row.id, capabilities }] : [];
    }).toSorted((a, b) => a.id.localeCompare(b.id));

    const channels = await listChannelsFor(db, user);
    expect(channels.map(({ id, capabilities }) => ({ id, capabilities })).toSorted((a, b) => a.id.localeCompare(b.id))).toEqual(expected);
    expect(channels.every((channel) => Channel.safeParse(channel).success && channel.unreadCount === 0)).toBe(true);
    // capabilitiesFor's three reads, then one channel read; nothing at all when signed out.
    expect(queries).toHaveLength(user ? 4 : 0);
  });

  it("orders cohort channels (newest cohort first), then community, then direct; archived last in each group", async () => {
    const fixture = setup({ globalRoles: ["ADMIN"] });
    const cohort = (programId: string) => ["main", "help", "announcements"].map((part) => slugOf(fixture, `cohort:${programId}:${part}`));
    expect((await listChannelsFor(fixture.db, fixture.user)).map(({ kind, slug }) => `${kind} ${slug}`)).toEqual([
      ...cohort("cohort-b").map((slug) => `COHORT ${slug}`),
      ...cohort("cohort-a").map((slug) => `COHORT ${slug}`), "COHORT cohort-a-old",
      ...["introductions", "show-your-work", "help", "opportunities", "design-crit", "team-news", "old-lounge"].map((slug) => `COMMUNITY ${slug}`),
      "DIRECT portfolio-review",
    ]);
  });

  it("returns the full channel contract, with the newest message anyone can still see", async () => {
    const fixture = setup({ applications: [{ programId: "cohort-a", status: "COMPLETED" }] });
    const id = (fixture.database.prepare("SELECT id FROM channel WHERE seedKey = 'cohort:cohort-a:main'").get() as { id: string }).id;
    fixture.database.prepare(`INSERT INTO channel_message (id, channelId, seq, changeSeq, authorId, body, createdAt, moderationState, moderationReasons, hiddenAt, deletedAt) VALUES
      ('m1', ?1, 1, 1, 'synthetic-wanjiku', 'Karibu, cohort!', 100, 'VISIBLE', '[]', NULL, NULL),
      ('m2', ?1, 2, 2, 'synthetic-otieno', 'Flagged but still up', 150, 'FLAGGED', '["contact details"]', NULL, NULL),
      ('m3', ?1, 3, 3, 'synthetic-otieno', 'Hidden by a moderator', 200, 'HIDDEN', '["harassment"]', 210, NULL),
      ('m4', ?1, 4, 4, 'synthetic-wanjiku', '', 300, 'VISIBLE', '[]', NULL, 310)`).run(id);
    const channel = (await listChannelsFor(fixture.db, fixture.user)).find((item) => item.id === id);
    expect(channel).toEqual({
      id, kind: "COHORT", slug: slugOf(fixture, "cohort:cohort-a:main"), name: slugOf(fixture, "cohort:cohort-a:main"),
      topic: "Everyday talk for the cohort, its mentors and its instructors.", postingPolicy: "ALL", programId: "cohort-a",
      unreadCount: 0, lastMessageAt: 150, archivedAt: null,
      capabilities: { canPost: true, canModerate: false, canShareSessionClip: true },
    });
  });

  it("reuses capabilities computed earlier in the request", async () => {
    const { db, user, queries } = setup({ applications: [{ programId: "cohort-a", status: "APPROVED" }] });
    const capabilities = await capabilitiesFor(db, user);
    queries.length = 0;
    expect(await listChannelsFor(db, user, capabilities)).toEqual(await listChannelsFor(db, user));
    expect(queries).toHaveLength(1 + 4);
  });

  it("reads revoked roles from the database on every call", async () => {
    const fixture = setup({ assignments: [{ programId: "cohort-a", name: "MENTOR" }] });
    expect((await listChannelsFor(fixture.db, fixture.user)).some(({ kind }) => kind === "COHORT")).toBe(true);
    fixture.database.exec("DELETE FROM programRole");
    expect((await listChannelsFor(fixture.db, fixture.user)).some(({ kind }) => kind === "COHORT")).toBe(false);
  });

  it("reads through indexes: channels by kind and program, conversations from the caller's memberships, the latest message", async () => {
    const fixture = setup({ applications: [{ programId: "cohort-a", status: "APPROVED" }] });
    await listChannelsFor(fixture.db, fixture.user);
    const plan = lastPlan(fixture);
    expect(plan).toContain("SEARCH channel USING INDEX channel_kind_idx (kind=? AND programId=?)");
    expect(plan).toContain("SEARCH channel_member USING COVERING INDEX channel_member_userId_idx (userId=?)");
    expect(plan).toContain("SEARCH channel USING INDEX sqlite_autoindex_channel_1 (id=?)");
    expect(plan).toContain("SEARCH channel_message USING INDEX channel_message_seq_idx (channelId=?)");
    expect(plan).not.toMatch(/\bSCAN (?:channel|channel_member|channel_message)\b/);
  });
});

describe("findReadableChannel", () => {
  it("opens a cohort's channel only for those who can read it, and answers everyone else exactly as for a missing slug", async () => {
    for (const fixture of CHANNEL_ACCESS_MATRIX) {
      const setupResult = setup(fixture);
      const { db, user } = setupResult;
      for (const [programId, target] of [["cohort-a", "cohortA"], ["cohort-b", "cohortB"]] as const) {
        const slug = slugOf(setupResult, `cohort:${programId}:main`);
        const found = await findReadableChannel(db, user, { space: "cohort", slug });
        const readable = accessFromLetters(fixture.channels[target]).canRead;
        expect({ persona: fixture.name, slug, found: found?.slug ?? null }).toEqual({ persona: fixture.name, slug, found: readable ? slug : null });
      }
      expect(await findReadableChannel(db, user, { space: "cohort", slug: "cohort-99" })).toBeNull();
    }
  });

  it("issues the same reads for another cohort's slug as for one that does not exist", async () => {
    const fixture = setup({ applications: [{ programId: "cohort-a", status: "APPROVED" }] });
    const run = async (slug: string) => {
      fixture.queries.length = 0;
      const found = await findReadableChannel(fixture.db, fixture.user, { space: "cohort", slug });
      return { found, queries: [...fixture.queries] };
    };
    expect(await run(slugOf(fixture, "cohort:cohort-b:main"))).toEqual(await run("cohort-99"));
  });

  it("looks a slug up through the partial slug index", async () => {
    const fixture = setup();
    await findReadableChannel(fixture.db, fixture.user, { space: "community", slug: "help" });
    expect(lastPlan(fixture)).toContain("SEARCH channel USING INDEX channel_slug_idx (slug=?)");
  });

  it("finds a channel only in its own space", async () => {
    const fixture = setup({ globalRoles: ["ADMIN"] });
    const cohortSlug = slugOf(fixture, "cohort:cohort-a:main");
    expect((await findReadableChannel(fixture.db, fixture.user, { space: "community", slug: "help" }))?.kind).toBe("COMMUNITY");
    expect((await findReadableChannel(fixture.db, fixture.user, { space: "cohort", slug: cohortSlug }))?.programId).toBe("cohort-a");
    expect(await findReadableChannel(fixture.db, fixture.user, { space: "community", slug: cohortSlug })).toBeNull();
    expect(await findReadableChannel(fixture.db, fixture.user, { space: "cohort", slug: "help" })).toBeNull();
    // Direct conversations never open at /c/<slug>, even for their members.
    expect(await findReadableChannel(fixture.db, fixture.user, { space: "community", slug: "portfolio-review" })).toBeNull();
  });

  it("opens community channels for institutions and community-only members", async () => {
    for (const globalRoles of [[], ["INSTITUTION"]]) {
      const fixture = setup({ globalRoles });
      expect(await findReadableChannel(fixture.db, fixture.user, { space: "community", slug: "introductions" }))
        .toMatchObject({ slug: "introductions", capabilities: { canPost: true, canModerate: false, canShareSessionClip: false } });
    }
  });

  it.each(["", "Help", "help-", "-help", "he_lp", "../admin", "help%2f..", "a".repeat(81)])("rejects the malformed slug %j without a query", async (slug) => {
    const { db, user, queries } = setup({ globalRoles: ["ADMIN"] });
    expect(await findReadableChannel(db, user, { space: "community", slug })).toBeNull();
    expect(queries).toHaveLength(0);
  });

  it("finds nothing for a signed-out caller, without a query", async () => {
    const { db, queries } = setup({ signedIn: false });
    expect(await findReadableChannel(db, null, { space: "community", slug: "help" })).toBeNull();
    expect(await listChannelsFor(db, undefined)).toEqual([]);
    expect(queries).toHaveLength(0);
  });
});
