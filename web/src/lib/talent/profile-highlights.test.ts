import { describe, expect, it, vi } from "vitest";
import type { SQL } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";
import { SQLiteSyncDialect } from "drizzle-orm/sqlite-core";
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

function mockDb(profileChanges = 1) {
  const deleteWhere = vi.fn((_condition: unknown) => ({
    meta: { changes: 1 },
  }));
  const insertSelect = vi.fn((_query: unknown) => ({
    meta: { changes: 1 },
  }));
  const updateSet = vi.fn((_values: unknown) => ({
    where: updateWhere,
  }));
  function updateWhere(_condition: unknown) {
    return { meta: { changes: profileChanges } };
  }
  const updateWhereSpy = vi.fn(updateWhere);
  updateSet.mockImplementation((_values: unknown) => ({
    where: updateWhereSpy,
  }));
  const batch = vi.fn(async (queries: unknown[]) => queries);

  return {
    db: {
      delete: vi.fn(() => ({ where: deleteWhere })),
      insert: vi.fn(() => ({ select: insertSelect })),
      update: vi.fn(() => ({ set: updateSet })),
      batch,
    },
    deleteWhere,
    insertSelect,
    updateSet,
    updateWhere: updateWhereSpy,
    batch,
  };
}

function queryText(value: unknown) {
  return new SQLiteSyncDialect().sqlToQuery(value as SQL);
}

describe("profile highlight moderation writes", () => {
  it("includes proposed highlight text in the fixed profile state", () => {
    expect(
      profileStateWithHighlights(profile, ["TypeScript"], [highlight]),
    ).toEqual(
      expect.objectContaining({
        displayName: "Checked Builder",
        highlights: [
          {
            repoFullName: "builder/project",
            description: "A useful project",
            blurb: "What I built",
            language: "TypeScript",
            topics: ["web"],
          },
        ],
      }),
    );
  });

  it("replaces published rows and advances moderation in one guarded batch", async () => {
    const { db, batch, deleteWhere, insertSelect, updateSet, updateWhere } =
      mockDb();

    await expect(
      replaceProfileHighlights(db as never, profile, [highlight], {
        outcome: "pass",
        flags: [],
        scores: {},
      }),
    ).resolves.toEqual({ outcome: "saved" });

    expect(batch).toHaveBeenCalledOnce();
    expect(batch.mock.calls[0][0]).toHaveLength(3);
    expect(updateSet).toHaveBeenCalledWith(
      expect.objectContaining({
        moderationOutcome: "pass",
        moderationReviewRequired: false,
      }),
    );
    for (const query of [
      queryText(deleteWhere.mock.calls[0][0]),
      queryText(insertSelect.mock.calls[0][0]),
      queryText(updateWhere.mock.calls[0][0]),
    ]) {
      expect(query.sql).toContain("contentVersion");
      expect(query.params).toContain(8);
      expect(query.params).toContain("PUBLISHED");
    }
  });

  it("generates executable guarded insert-select statements for D1", async () => {
    const statements: Array<{ sql: string; params: unknown[] }> = [];
    const client = {
      prepare: (query: string) => ({
        bind: (...params: unknown[]) => ({ sql: query, params }),
      }),
      batch: async (queries: Array<{ sql: string; params: unknown[] }>) => {
        statements.push(...queries);
        return queries.map(() => ({
          results: [],
          success: true,
          meta: { changes: 1 },
        }));
      },
    };
    const db = drizzle(client as never, { schema });

    await expect(
      replaceProfileHighlights(db, profile, [highlight], {
        outcome: "pass",
        flags: [],
        scores: {},
      }),
    ).resolves.toEqual({ outcome: "saved" });

    expect(statements).toHaveLength(3);
    expect(statements[0]?.sql).toMatch(/^delete from "profileHighlight"/);
    expect(statements[1]?.sql).toMatch(
      /^insert into "profileHighlight"[\s\S]* select\s/,
    );
    expect(statements[1]?.sql).toContain("where exists");
    expect(statements[2]?.sql).toMatch(/^update "studentProfile" set/);
    for (const statement of statements) {
      expect(statement.params).toContain(8);
      expect(statement.params).toContain("PUBLISHED");
    }
  });

  it("keeps live rows on hold and stores only the decision", async () => {
    const { db, batch, deleteWhere, updateSet } = mockDb();

    await expect(
      replaceProfileHighlights(db as never, profile, [highlight], {
        outcome: "hold",
        flags: ["contains_contact_details"],
        scores: { contains_contact_details: 0.95 },
      }),
    ).resolves.toEqual({ outcome: "hold" });

    expect(batch).not.toHaveBeenCalled();
    expect(deleteWhere).not.toHaveBeenCalled();
    expect(updateSet).toHaveBeenCalledWith(
      expect.objectContaining({
        moderationOutcome: "hold",
        moderationReviewRequired: true,
      }),
    );
  });

  it("fails open and flags published highlight rows for review", async () => {
    const { db, updateSet } = mockDb();

    await expect(
      replaceProfileHighlights(db as never, profile, [highlight], {
        outcome: "error",
        flags: [],
        scores: {},
      }),
    ).resolves.toEqual({ outcome: "saved" });
    expect(updateSet).toHaveBeenCalledWith(
      expect.objectContaining({
        moderationOutcome: "error",
        moderationReviewRequired: true,
      }),
    );
  });

  it("rejects suspended and stale profile writes", async () => {
    const suspended = mockDb();
    await expect(
      replaceProfileHighlights(
        suspended.db as never,
        { ...profile, status: "SUSPENDED" },
        [highlight],
      ),
    ).resolves.toEqual({ outcome: "suspended" });
    expect(suspended.batch).not.toHaveBeenCalled();

    const stale = mockDb(0);
    await expect(
      replaceProfileHighlights(stale.db as never, profile, [highlight], {
        outcome: "pass",
        flags: [],
        scores: {},
      }),
    ).resolves.toEqual({ outcome: "conflict" });
  });
});
