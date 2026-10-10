import { describe, expect, it } from "vitest";
import {
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
    expect(publishesAfterModeration({ outcome: "pass", flags: [], scores: {} })).toBe(
      true
    );
    expect(
      publishesAfterModeration({ outcome: "error", flags: [], scores: {} })
    ).toBe(true);
    expect(
      publishesAfterModeration({
        outcome: "hold",
        flags: ["contains_contact_details"],
        scores: { contains_contact_details: 0.9 },
      })
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
        checkedAt
      )
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
      parseModerationFlags('["contains_contact_details","unknown",12]')
    ).toEqual(["contains_contact_details"]);
    expect(
      parseModerationScores(
        '{"contains_contact_details":0.9,"abusive_or_sexual":2,"unknown":0.5}'
      )
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
        { status: "DRAFT", publishedAt },
        "publish",
        new Date("2026-10-10")
      )
    ).toEqual({
      status: "PUBLISHED",
      moderationReviewRequired: false,
    });
  });

  it("sets the first publication date and supports unpublish and clear flag", () => {
    const now = new Date("2026-10-10");
    expect(
      resolveAdminProfileUpdate({ status: "DRAFT", publishedAt: null }, "publish", now)
    ).toEqual({
      status: "PUBLISHED",
      moderationReviewRequired: false,
      publishedAt: now,
    });
    expect(
      resolveAdminProfileUpdate(
        { status: "PUBLISHED", publishedAt: now },
        "unpublish"
      )
    ).toEqual({ status: "SUSPENDED" });
    expect(
      resolveAdminProfileUpdate({ status: "DRAFT", publishedAt: null }, "clear_flag")
    ).toEqual({ moderationReviewRequired: false });
  });
});
