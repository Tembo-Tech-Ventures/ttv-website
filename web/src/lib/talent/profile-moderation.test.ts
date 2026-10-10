import { SQLiteSyncDialect } from "drizzle-orm/sqlite-core";
import type { SQL } from "drizzle-orm";
import { describe, expect, it, vi } from "vitest";
import {
  applyAdminProfileAction,
  moderationColumns,
  parseAdminProfileAction,
  parseModerationFlags,
  parseModerationScores,
  publishesAfterModeration,
  resolveAdminProfileUpdate,
  splitModerationReviewLists,
} from "./profile-moderation";

describe("profile moderation transitions", () => {
  it("publishes pass and error outcomes but holds flagged content", () => {
    expect(
      publishesAfterModeration({ outcome: "pass", flags: [], scores: {} }),
    ).toBe(true);
    expect(
      publishesAfterModeration({ outcome: "error", flags: [], scores: {} }),
    ).toBe(true);
    expect(
      publishesAfterModeration({
        outcome: "hold",
        flags: ["contains_contact_details"],
        scores: { contains_contact_details: 0.9 },
      }),
    ).toBe(false);
  });

  it("persists the outcome, flags, scores, timestamp, and review requirement", () => {
    const checkedAt = new Date("2026-10-10T12:00:00Z");
    expect(
      moderationColumns(
        {
          outcome: "hold",
          flags: ["contains_contact_details"],
          scores: { contains_contact_details: 0.91 },
        },
        checkedAt,
      ),
    ).toEqual({
      moderationOutcome: "hold",
      moderationFlags: '["contains_contact_details"]',
      moderationScores: '{"contains_contact_details":0.91}',
      moderationCheckedAt: checkedAt,
      moderationReviewRequired: true,
    });
  });

  it("parses only known, valid stored flags and scores", () => {
    expect(
      parseModerationFlags('["contains_contact_details","unknown",12]'),
    ).toEqual(["contains_contact_details"]);
    expect(
      parseModerationScores(
        '{"contains_contact_details":0.9,"abusive_or_sexual":2,"unknown":0.5}',
      ),
    ).toEqual({ contains_contact_details: 0.9 });
    expect(parseModerationFlags("not json")).toEqual([]);
    expect(parseModerationScores("not json")).toEqual({});
  });

  it("separates held and fail-open profiles newest first", () => {
    const base = {
      status: "DRAFT",
      moderationFlags: "[]",
      moderationScores: "{}",
      moderationReviewRequired: true,
      updatedAt: new Date("2026-10-01"),
    };
    const rows = [
      {
        ...base,
        id: "held-old",
        moderationOutcome: "hold" as const,
        moderationCheckedAt: new Date("2026-10-02"),
      },
      {
        ...base,
        id: "error",
        status: "PUBLISHED",
        moderationOutcome: "error" as const,
        moderationCheckedAt: new Date("2026-10-03"),
      },
      {
        ...base,
        id: "held-new",
        moderationOutcome: "hold" as const,
        moderationCheckedAt: new Date("2026-10-04"),
      },
      {
        ...base,
        id: "cleared",
        moderationOutcome: "hold" as const,
        moderationReviewRequired: false,
        moderationCheckedAt: new Date("2026-10-05"),
      },
    ];

    const lists = splitModerationReviewLists(rows);
    expect(lists.held.map((row) => row.id)).toEqual(["held-new", "held-old"]);
    expect(lists.unavailable.map((row) => row.id)).toEqual(["error"]);
  });
});

describe("admin profile moderation actions", () => {
  it("accepts only the three fixed actions", () => {
    expect(parseAdminProfileAction("publish")).toBe("publish");
    expect(parseAdminProfileAction("unpublish")).toBe("unpublish");
    expect(parseAdminProfileAction("clear_flag")).toBe("clear_flag");
    expect(parseAdminProfileAction("delete")).toBeNull();
  });

  it("publishes, preserves an existing publication date, and clears the flag", () => {
    const publishedAt = new Date("2026-01-01");
    expect(
      resolveAdminProfileUpdate(
        {
          status: "DRAFT",
          publishedAt,
          contentVersion: 3,
          publicName: "Checked Builder",
          publicAvatarUrl: "/api/avatar/avatars/user-1/checked.webp",
        },
        "publish",
        new Date("2026-10-10"),
      ),
    ).toEqual({
      status: "PUBLISHED",
      contentVersion: 4,
      moderationReviewRequired: false,
      publicName: "Checked Builder",
      publicAvatarUrl: "/api/avatar/avatars/user-1/checked.webp",
    });
  });

  it("sets the first publication date and supports unpublish and clear flag", () => {
    const now = new Date("2026-10-10");
    expect(
      resolveAdminProfileUpdate(
        {
          status: "DRAFT",
          publishedAt: null,
          contentVersion: 6,
          user: {
            name: "Draft Builder",
            image: "https://avatars.githubusercontent.com/u/123",
          },
        },
        "publish",
        now,
      ),
    ).toEqual({
      status: "PUBLISHED",
      contentVersion: 7,
      moderationReviewRequired: false,
      publicName: "Draft Builder",
      publicAvatarUrl: null,
      publishedAt: now,
    });
    expect(
      resolveAdminProfileUpdate(
        { status: "PUBLISHED", publishedAt: now, contentVersion: 7 },
        "unpublish",
      ),
    ).toEqual({ status: "SUSPENDED", contentVersion: 8 });
    expect(
      resolveAdminProfileUpdate(
        { status: "DRAFT", publishedAt: null, contentVersion: 2 },
        "clear_flag",
      ),
    ).toEqual({ moderationReviewRequired: false, contentVersion: 3 });
  });

  it("applies admin actions only to the version that was reviewed", async () => {
    const where = vi.fn((_condition: unknown) => ({ meta: { changes: 1 } }));
    const set = vi.fn(() => ({ where }));
    const db = { update: vi.fn(() => ({ set })) };

    await expect(
      applyAdminProfileAction(
        db as never,
        "profile-1",
        { status: "PUBLISHED", publishedAt: new Date(), contentVersion: 9 },
        "unpublish",
      ),
    ).resolves.toBe(true);

    expect(set).toHaveBeenCalledWith({
      status: "SUSPENDED",
      contentVersion: 10,
    });
    const query = new SQLiteSyncDialect().sqlToQuery(
      where.mock.calls[0][0] as SQL,
    );
    expect(query.sql).toContain('"studentProfile"."id" = ?');
    expect(query.sql).toContain('"studentProfile"."contentVersion" = ?');
    expect(query.params).toEqual(["profile-1", 9]);
  });

  it("reports an admin conflict when another write wins", async () => {
    const db = {
      update: vi.fn(() => ({
        set: vi.fn(() => ({
          where: vi.fn(() => ({ meta: { changes: 0 } })),
        })),
      })),
    };

    await expect(
      applyAdminProfileAction(
        db as never,
        "profile-1",
        { status: "DRAFT", publishedAt: null, contentVersion: 4 },
        "publish",
      ),
    ).resolves.toBe(false);
  });
});
