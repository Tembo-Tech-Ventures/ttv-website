import { SQLiteSyncDialect } from "drizzle-orm/sqlite-core";
import type { SQL } from "drizzle-orm";
import { describe, expect, it, vi } from "vitest";
import {
  applyAdminProfileAction,
  moderationColumns,
  parseAdminProfileAction,
  parseAdminProfileVersion,
  parseModerationFlags,
  publishesAfterModeration,
  resolveAdminProfileUpdate,
  restoredStatus,
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

  it("parses only known stored flags", () => {
    expect(
      parseModerationFlags('["contains_contact_details","unknown",12]'),
    ).toEqual(["contains_contact_details"]);
    expect(parseModerationFlags("not json")).toEqual([]);
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
    expect(parseAdminProfileVersion("0")).toBe(0);
    expect(parseAdminProfileVersion("12")).toBe(12);
    expect(parseAdminProfileVersion("-1")).toBeNull();
    expect(parseAdminProfileVersion("1.5")).toBeNull();
    expect(parseAdminProfileVersion(null)).toBeNull();
  });

  it("restores a paused profile to what the pause interrupted, never listing someone who took themselves off", () => {
    const publishedAt = new Date("2026-01-01");
    // Paused while listed: republished as it is now, the first publication date kept.
    expect(
      resolveAdminProfileUpdate(
        {
          status: "SUSPENDED",
          suspendedFrom: "PUBLISHED",
          publishedAt,
          contentVersion: 3,
          publicName: "Checked Builder",
          publicAvatarUrl: "/api/avatar/avatars/user-1/checked.webp",
        },
        "publish",
        new Date("2026-10-10"),
      ),
    ).toEqual({
      suspendedFrom: null,
      status: "PUBLISHED",
      contentVersion: 4,
      moderationReviewRequired: false, moderationOutcome: "pass",
      publicName: "Checked Builder",
      publicAvatarUrl: "/api/avatar/avatars/user-1/checked.webp",
    });
    // Paused after they took themselves off (publishedAt still set): back to members only.
    expect(
      resolveAdminProfileUpdate({ status: "SUSPENDED", suspendedFrom: "DRAFT", publishedAt, contentVersion: 5 }, "publish"),
    ).toEqual({ status: "DRAFT", suspendedFrom: null, contentVersion: 6 });
    // Paused before this was recorded: a profile never listed goes back to being a draft.
    expect(restoredStatus({ suspendedFrom: null, publishedAt: null })).toBe("DRAFT");
    expect(restoredStatus({ suspendedFrom: null, publishedAt })).toBe("PUBLISHED");
  });

  it("remembers what a pause interrupts, and clears a flag", () => {
    const now = new Date("2026-10-10");
    expect(
      resolveAdminProfileUpdate({ status: "PUBLISHED", publishedAt: now, contentVersion: 7 }, "unpublish"),
    ).toEqual({ status: "SUSPENDED", suspendedFrom: "PUBLISHED", contentVersion: 8 });
    expect(
      resolveAdminProfileUpdate({ status: "DRAFT", publishedAt: now, contentVersion: 2 }, "unpublish"),
    ).toEqual({ status: "SUSPENDED", suspendedFrom: "DRAFT", contentVersion: 3 });
    expect(
      resolveAdminProfileUpdate(
        { status: "DRAFT", publishedAt: null, contentVersion: 2 },
        "clear_flag",
      ),
    ).toEqual({ moderationReviewRequired: false, moderationOutcome: "pass", contentVersion: 3 });
  });

  it("never lets an admin publish a draft: listing is the member's own choice", async () => {
    const update = vi.fn();
    await expect(
      applyAdminProfileAction(
        { update } as never,
        "profile-1",
        { status: "DRAFT", publishedAt: new Date(), contentVersion: 4 },
        "publish",
        4,
      ),
    ).resolves.toBe("changed");
    expect(update).not.toHaveBeenCalled();
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
        9,
      ),
    ).resolves.toBe("done");

    expect(set).toHaveBeenCalledWith({
      status: "SUSPENDED",
      suspendedFrom: "PUBLISHED",
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
      query:{studentProfile:{findFirst:vi.fn(async()=>({userId:"user-1"}))},programApplication:{findFirst:vi.fn(async()=>({status:"COMPLETED",completedAt:new Date()}))}},
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
        { status: "SUSPENDED", suspendedFrom: "PUBLISHED", publishedAt: new Date(), contentVersion: 4 },
        "publish",
        4,
      ),
    ).resolves.toBe("changed");
  });

  it("rejects an action rendered for an older profile version", async () => {
    const update = vi.fn();
    const db = { update };

    await expect(
      applyAdminProfileAction(
        db as never,
        "profile-1",
        { status: "DRAFT", publishedAt: null, contentVersion: 6 },
        "publish",
        5,
      ),
    ).resolves.toBe("changed");
    expect(update).not.toHaveBeenCalled();
  });

  it("says a Republish needs a completed cohort, and changes nothing", async () => {
    const update = vi.fn();
    const db = {
      query: { studentProfile: { findFirst: vi.fn(async () => ({ userId: "user-1" })) }, programApplication: { findFirst: vi.fn(async () => undefined) } },
      update,
    };
    await expect(
      applyAdminProfileAction(
        db as never,
        "profile-1",
        { status: "SUSPENDED", suspendedFrom: "PUBLISHED", publishedAt: new Date(), contentVersion: 2 },
        "publish",
        2,
      ),
    ).resolves.toBe("ineligible");
    expect(update).not.toHaveBeenCalled();
  });
});
