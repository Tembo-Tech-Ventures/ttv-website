import { describe, expect, it, vi } from "vitest";
import type { Database } from "@/lib/db/schema";
import {
  moderatePost,
  normalizeAdminNote,
  parsePostModerationAction,
} from "./moderation";

function database(changes = 1) {
  const where = vi.fn().mockResolvedValue({ meta: { changes } });
  const set = vi.fn(() => ({ where }));
  const db = { update: vi.fn(() => ({ set })) } as unknown as Database;
  return { db, set, where };
}

function columnsReferencedBy(condition: unknown): string[] {
  const names: string[] = [];
  const seen = new WeakSet<object>();

  const visit = (node: unknown) => {
    if (!node || typeof node !== "object" || seen.has(node)) return;
    seen.add(node);
    const record = node as Record<string, unknown>;
    if (typeof record.name === "string" && "table" in record) {
      names.push(record.name);
      return;
    }
    for (const value of Object.values(record)) {
      if (Array.isArray(value)) value.forEach(visit);
      else visit(value);
    }
  };

  visit(condition);
  return names;
}

describe("post moderation input", () => {
  it("accepts only the two one-button actions", () => {
    expect(parsePostModerationAction("suspend")).toBe("suspend");
    expect(parsePostModerationAction("restore")).toBe("restore");
    expect(parsePostModerationAction("delete")).toBeNull();
    expect(parsePostModerationAction(null)).toBeNull();
  });

  it("trims optional notes and bounds their stored length", () => {
    expect(normalizeAdminNote("  community guideline note  ")).toBe(
      "community guideline note"
    );
    expect(normalizeAdminNote("   ")).toBeNull();
    expect(normalizeAdminNote("x".repeat(1_100))).toHaveLength(1_000);
  });
});

describe("moderatePost", () => {
  it("suspends a published post with the optional note", async () => {
    const { db, set, where } = database();
    await expect(
      moderatePost(db, {
        profileId: "profile-1",
        postId: "post-1",
        action: "suspend",
        adminNote: "Needs a source check",
      })
    ).resolves.toEqual({ success: true });

    expect(set).toHaveBeenCalledWith({
      status: "SUSPENDED",
      adminNote: "Needs a source check",
    });
    expect(where).toHaveBeenCalledOnce();
    expect(columnsReferencedBy(where.mock.calls[0][0])).toEqual(
      expect.arrayContaining(["id", "profileId", "status"])
    );
  });

  it("restores a suspended post directly to published", async () => {
    const { db, set } = database();
    await moderatePost(db, {
      profileId: "profile-1",
      postId: "post-1",
      action: "restore",
      adminNote: null,
    });
    expect(set).toHaveBeenCalledWith({ status: "PUBLISHED", adminNote: null });
  });

  it("reports a stale or cross-profile transition without claiming success", async () => {
    const { db } = database(0);
    await expect(
      moderatePost(db, {
        profileId: "profile-1",
        postId: "post-elsewhere",
        action: "suspend",
        adminNote: null,
      })
    ).resolves.toEqual({
      success: false,
      error: "The post could not be suspended from its current state.",
    });
  });
});
