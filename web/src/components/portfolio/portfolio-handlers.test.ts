import { describe, it, expect, vi } from "vitest";
import { SQLiteSyncDialect } from "drizzle-orm/sqlite-core";
import {
  extractProfileFormData,
  publishProfile,
  validateProfileHandle,
  saveProfile,
} from "./portfolio-handlers";

function makeFormData(entries: Record<string, string>): FormData {
  const fd = new FormData();
  for (const [k, v] of Object.entries(entries)) {
    fd.set(k, v);
  }
  return fd;
}

describe("extractProfileFormData", () => {
  it("extracts text fields correctly", () => {
    const fd = makeFormData({
      handle: " MyHandle ",
      headline: "Full-Stack Dev",
      bio: "Hello world",
      location: "Lagos",
      country: "Nigeria",
      skills: "TypeScript, React, Node.js",
      portfolioUrl: "https://example.com",
      linkedinUrl: "https://linkedin.com/in/test",
    });
    const result = extractProfileFormData(fd);
    expect(result.handle).toBe(" MyHandle ");
    expect(result.headline).toBe("Full-Stack Dev");
    expect(result.bio).toBe("Hello world");
    expect(result.location).toBe("Lagos");
    expect(result.country).toBe("Nigeria");
    expect(result.skills).toEqual(["TypeScript", "React", "Node.js"]);
    expect(result.portfolioUrl).toBe("https://example.com");
    expect(result.linkedinUrl).toBe("https://linkedin.com/in/test");
  });

  it("maps empty strings to undefined for optional fields", () => {
    const fd = makeFormData({ handle: "test" });
    const result = extractProfileFormData(fd);
    expect(result.headline).toBeUndefined();
    expect(result.bio).toBeUndefined();
    expect(result.skills).toBeUndefined();
  });

  it("maps checkbox 'on' to true, absent to false", () => {
    const fd = makeFormData({ handle: "test", openToFreelance: "on" });
    const result = extractProfileFormData(fd);
    expect(result.openToFreelance).toBe(true);
    expect(result.openToRoles).toBe(false);
  });

  it("filters empty skill tags from comma-separated input", () => {
    const fd = makeFormData({ handle: "test", skills: "React, , , Node.js, " });
    const result = extractProfileFormData(fd);
    expect(result.skills).toEqual(["React", "Node.js"]);
  });
});

function mockDb(
  overrides: {
    findProfile?: unknown;
    findProfileByHandle?: unknown;
    /**
     * Row returned to the handle-lock lookup in `saveProfile`, which is the only
     * query selecting `publishedAt`. Defaults to null so existing cases behave as
     * an unpublished profile and the lock stays out of the way.
     */
    findProfileForLock?: {
      handle: string;
      publishedAt: Date | null;
      status?: "DRAFT" | "PUBLISHED" | "SUSPENDED";
      githubLogin?: string | null;
      publicName?: string | null;
      publicAvatarUrl?: string | null;
      user?: { name: string; image?: string | null };
    } | null;
    insertProfile?: () => void;
    updateProfile?: (condition?: unknown) => void;
    updateChanges?: number;
    setProfile?: (values: unknown) => void;
  } = {},
) {
  const insertFn = vi.fn(overrides.insertProfile ?? (() => {}));
  const updateFn = vi.fn(overrides.updateProfile ?? (() => {}));

  return {
    query: {
      studentProfile: {
        findFirst: vi.fn(
          async (opts?: {
            where?: unknown;
            columns?: Record<string, unknown>;
          }) => {
            // Dispatch on requested columns: `saveProfile` issues two distinct
            // lookups (handle lock, then handle uniqueness) against this mock.
            if (opts?.columns && "publishedAt" in opts.columns) {
              return overrides.findProfileForLock ?? null;
            }
            if (opts?.where && typeof opts.where === "function") {
              return overrides.findProfile ?? null;
            }
            return (
              overrides.findProfileByHandle ?? overrides.findProfile ?? null
            );
          },
        ),
      },
    },
    insert: vi.fn(() => ({
      values: insertFn,
    })),
    update: vi.fn(() => ({
      set: vi.fn((values: unknown) => {
        overrides.setProfile?.(values);
        return {
          where: (condition: unknown) => {
            updateFn(condition);
            return { meta: { changes: overrides.updateChanges ?? 1 } };
          },
        };
      }),
    })),
  } as unknown;
}

describe("validateProfileHandle", () => {
  it("rejects empty handle", async () => {
    const db = mockDb();
    const result = await validateProfileHandle("", db as never);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toBe("Handle is required");
  });

  it("rejects too-short handle", async () => {
    const db = mockDb();
    const result = await validateProfileHandle("ab", db as never);
    expect(result.ok).toBe(false);
    if (!result.ok)
      expect(result.error).toBe("Handle must be at least 3 characters");
  });

  it("rejects reserved handle", async () => {
    const db = mockDb();
    const result = await validateProfileHandle("admin", db as never);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toBe("This handle is reserved");
  });

  it("rejects invalid characters", async () => {
    const db = mockDb();
    const result = await validateProfileHandle("my_handle!", db as never);
    expect(result.ok).toBe(false);
    if (!result.ok)
      expect(result.error).toContain("lowercase letters, numbers, and hyphens");
  });

  it("rejects double hyphens", async () => {
    const db = mockDb();
    const result = await validateProfileHandle("my--handle", db as never);
    expect(result.ok).toBe(false);
    if (!result.ok)
      expect(result.error).toBe("Handle cannot contain consecutive hyphens");
  });

  it("rejects duplicate handle", async () => {
    const db = mockDb({ findProfileByHandle: { id: "other-id" } });
    const result = await validateProfileHandle("taken-handle", db as never);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toBe("This handle is already taken");
  });

  it("allows duplicate handle if same profile (update case)", async () => {
    const db = mockDb({ findProfileByHandle: { id: "same-id" } });
    const result = await validateProfileHandle(
      "my-handle",
      db as never,
      "same-id",
    );
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.normalized).toBe("my-handle");
  });

  it("normalizes and accepts valid handle", async () => {
    const db = mockDb();
    const result = await validateProfileHandle("  MyHandle  ", db as never);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.normalized).toBe("myhandle");
  });
});

describe("saveProfile", () => {
  it("creates a new profile when no existing ID", async () => {
    const insertFn = vi.fn();
    const db = mockDb({ insertProfile: insertFn });

    const fd = makeFormData({
      handle: "new-user",
      headline: "Developer",
      bio: "I build things",
    });

    const result = await saveProfile(db as never, "user-1", fd);
    expect(result.success).toBe(true);
  });

  it("fails on validation error for handle", async () => {
    const db = mockDb();
    const fd = makeFormData({ handle: "ab" });

    const result = await saveProfile(db as never, "user-1", fd);
    expect(result.success).toBe(false);
    expect(result.handleError).toBeTruthy();
  });

  it("fails on invalid URL", async () => {
    const db = mockDb();
    const fd = makeFormData({
      handle: "valid-handle",
      portfolioUrl: "not-a-url",
    });

    const result = await saveProfile(db as never, "user-1", fd);
    expect(result.success).toBe(false);
    expect(result.fieldErrors?.portfolioUrl).toBeTruthy();
  });

  it("maps empty URL strings to null in DB values", async () => {
    const insertFn = vi.fn();
    const db = mockDb({ insertProfile: insertFn });

    const fd = makeFormData({
      handle: "valid-handle",
      portfolioUrl: "",
      linkedinUrl: "",
    });

    const result = await saveProfile(db as never, "user-1", fd);
    expect(result.success).toBe(true);
  });

  it("updates existing profile when ID provided", async () => {
    const updateFn = vi.fn();
    const db = mockDb({
      findProfileForLock: {
        handle: "existing-user",
        publishedAt: null,
        status: "DRAFT",
        githubLogin: "existing-user",
      },
      findProfileByHandle: null,
      updateProfile: updateFn,
    });

    const fd = makeFormData({
      handle: "existing-user",
      headline: "Updated headline",
    });

    const result = await saveProfile(db as never, "user-1", fd, "profile-1");
    expect(result.success).toBe(true);
  });

  it("rejects edits to a suspended profile at the handler boundary", async () => {
    const updateFn = vi.fn();
    const checkContent = vi.fn();
    const db = mockDb({
      findProfileForLock: {
        handle: "suspended-user",
        publishedAt: new Date("2026-01-01"),
        status: "SUSPENDED",
        githubLogin: "suspended-user",
        user: { name: "Suspended User" },
      },
      updateProfile: updateFn,
    });

    const result = await saveProfile(
      db as never,
      "user-1",
      makeFormData({ handle: "suspended-user", bio: "Changed content" }),
      "profile-1",
      checkContent,
    );

    expect(result).toEqual({
      success: false,
      error: "A suspended profile cannot be edited.",
    });
    expect(checkContent).not.toHaveBeenCalled();
    expect(updateFn).not.toHaveBeenCalled();
  });

  // A published handle is part of every blog post permalink
  // (`/blog/[handle]/[slug]`), so renaming would 404 every post.
  describe("handle lock after publish", () => {
    it("rejects a handle change once the profile is published", async () => {
      const updateFn = vi.fn();
      const db = mockDb({
        findProfileForLock: {
          handle: "old-handle",
          publishedAt: new Date("2026-01-01"),
        },
        updateProfile: updateFn,
      });

      const fd = makeFormData({ handle: "new-handle", headline: "Dev" });
      const result = await saveProfile(db as never, "user-1", fd, "profile-1");

      expect(result.success).toBe(false);
      expect(result.handleError).toBe(
        "Your handle is locked once your profile is published, because it is part of your post links.",
      );
      // The assertion that actually matters: nothing was written. Without it a
      // mutant that returns the error but still updates would pass.
      expect(updateFn).not.toHaveBeenCalled();
    });

    it("allows saving other fields when the published handle is unchanged", async () => {
      const updateFn = vi.fn();
      const db = mockDb({
        findProfileForLock: {
          handle: "existing-user",
          publishedAt: new Date("2026-01-01"),
          status: "PUBLISHED",
          githubLogin: "existing-user",
          user: { name: "Existing User" },
        },
        findProfileByHandle: { id: "profile-1" },
        updateProfile: updateFn,
      });

      const fd = makeFormData({
        handle: "existing-user",
        headline: "Updated headline",
      });
      const result = await saveProfile(db as never, "user-1", fd, "profile-1");

      expect(result.success).toBe(true);
      expect(updateFn).toHaveBeenCalledTimes(1);
    });

    it("treats a differently-cased submission of the same handle as unchanged", async () => {
      const updateFn = vi.fn();
      const db = mockDb({
        findProfileForLock: {
          handle: "existing-user",
          publishedAt: new Date("2026-01-01"),
          status: "PUBLISHED",
          githubLogin: "existing-user",
          user: { name: "Existing User" },
        },
        findProfileByHandle: { id: "profile-1" },
        updateProfile: updateFn,
      });

      const fd = makeFormData({ handle: "  Existing-User  " });
      const result = await saveProfile(db as never, "user-1", fd, "profile-1");

      expect(result.success).toBe(true);
      expect(result.handleError).toBeUndefined();
      expect(updateFn).toHaveBeenCalledTimes(1);
    });

    it("allows a handle change while the profile is still unpublished", async () => {
      const updateFn = vi.fn();
      const db = mockDb({
        findProfileForLock: {
          handle: "old-handle",
          publishedAt: null,
          status: "DRAFT",
        },
        findProfileByHandle: null,
        updateProfile: updateFn,
      });

      const fd = makeFormData({ handle: "new-handle" });
      const result = await saveProfile(db as never, "user-1", fd, "profile-1");

      expect(result.success).toBe(true);
      expect(updateFn).toHaveBeenCalledTimes(1);
    });

    it("does not mutate a draft suspended while the save is in flight", async () => {
      const updateFn = vi.fn();
      const db = mockDb({
        findProfileForLock: {
          handle: "draft-user",
          publishedAt: null,
          status: "DRAFT",
        },
        findProfileByHandle: { id: "profile-1" },
        updateProfile: updateFn,
        updateChanges: 0,
      });

      const result = await saveProfile(
        db as never,
        "user-1",
        makeFormData({ handle: "draft-user", bio: "Changed content" }),
        "profile-1",
      );

      expect(result).toEqual({
        success: false,
        error:
          "This profile changed while your request was running. Reload and try again.",
      });
      expectStatusWriteGuard(updateFn, "DRAFT");
    });
  });

  it("rejects skills exceeding max 12", async () => {
    const db = mockDb();
    const fd = makeFormData({
      handle: "valid-handle",
      skills: "a,b,c,d,e,f,g,h,i,j,k,l,m",
    });

    const result = await saveProfile(db as never, "user-1", fd);
    expect(result.success).toBe(false);
    expect(result.fieldErrors?.skills).toBeTruthy();
  });
});

const draftProfile = {
  status: "DRAFT" as const,
  handle: "new-user",
  headline: "Developer",
  bio: "I build useful things",
  location: "Lagos",
  country: "Nigeria",
  skills: '["TypeScript"]',
  githubLogin: "new-user",
  user: {
    name: "New User",
    image: "/api/avatar/avatars/user-1/photo.webp",
  },
  portfolioUrl: "https://example.com",
  linkedinUrl: null,
  publishedAt: null,
};

type ModerationProfile = Omit<typeof draftProfile, "status" | "publishedAt"> & {
  status: "DRAFT" | "PUBLISHED" | "SUSPENDED";
  publishedAt: Date | null;
};

function moderationDb(
  profile: ModerationProfile | null,
  setProfile = vi.fn(),
  changes = 1,
) {
  const where = vi.fn().mockReturnValue({ meta: { changes } });
  return {
    db: {
      query: {
        studentProfile: {
          findFirst: vi.fn(async () => profile),
        },
      },
      update: vi.fn(() => ({
        set: vi.fn((values: unknown) => {
          setProfile(values);
          return { where };
        }),
      })),
    },
    setProfile,
    where,
  };
}

function expectStatusWriteGuard(
  where: ReturnType<typeof vi.fn>,
  expectedStatus: "DRAFT" | "PUBLISHED",
) {
  const condition = where.mock.calls[0]?.[0];
  const query = new SQLiteSyncDialect().sqlToQuery(condition);
  expect(query.sql).toContain('"studentProfile"."status" = ?');
  expect(query.params).toContain(expectedStatus);
}

describe("publishProfile", () => {
  it("publishes a passing draft immediately", async () => {
    const { db, setProfile, where } = moderationDb(draftProfile);
    const checkedAt = new Date("2026-10-10T12:00:00Z");
    const checkContent = vi
      .fn()
      .mockResolvedValue({ outcome: "pass", flags: [], scores: {} });
    vi.useFakeTimers();
    vi.setSystemTime(checkedAt);

    const result = await publishProfile(
      db as never,
      "user-1",
      "profile-1",
      checkContent,
    );

    expect(result).toMatchObject({ success: true, published: true });
    expect(setProfile).toHaveBeenCalledWith(
      expect.objectContaining({
        status: "PUBLISHED",
        publishedAt: checkedAt,
        publicName: "New User",
        publicAvatarUrl: "/api/avatar/avatars/user-1/photo.webp",
        moderationOutcome: "pass",
        moderationReviewRequired: false,
      }),
    );
    expect(checkContent).toHaveBeenCalledWith(
      expect.objectContaining({ displayName: "New User" }),
      "/api/avatar/avatars/user-1/photo.webp",
    );
    expectStatusWriteGuard(where, "DRAFT");
    vi.useRealTimers();
  });

  it("holds flagged content with a fixed explanation and keeps the draft private", async () => {
    const { db, setProfile } = moderationDb(draftProfile);
    const result = await publishProfile(
      db as never,
      "user-1",
      "profile-1",
      () =>
        Promise.resolve({
          outcome: "hold",
          flags: ["contains_contact_details"],
          scores: { contains_contact_details: 0.92 },
        }),
    );

    expect(result).toEqual(
      expect.objectContaining({
        success: false,
        published: false,
        moderationOutcome: "hold",
        moderationMessages: [
          "Remove phone numbers, email addresses, or ID numbers from your public profile.",
        ],
      }),
    );
    expect(setProfile).toHaveBeenCalledWith(
      expect.objectContaining({
        publicName: "New User",
        publicAvatarUrl: "/api/avatar/avatars/user-1/photo.webp",
        moderationOutcome: "hold",
      }),
    );
    expect(setProfile.mock.calls[0]?.[0]).not.toHaveProperty("status");
    expect(setProfile.mock.calls[0]?.[0]).not.toHaveProperty("publishedAt");
  });

  it("does not overwrite an admin status change made during the check", async () => {
    const { db, where } = moderationDb(draftProfile, vi.fn(), 0);
    const result = await publishProfile(
      db as never,
      "user-1",
      "profile-1",
      () => Promise.resolve({ outcome: "pass", flags: [], scores: {} }),
    );

    expect(result).toEqual({
      success: false,
      error:
        "This profile changed while your request was running. Reload and try again.",
    });
    expectStatusWriteGuard(where, "DRAFT");
  });

  it("fails open when the check is unavailable and flags the published profile", async () => {
    const { db, setProfile } = moderationDb(draftProfile);
    const result = await publishProfile(
      db as never,
      "user-1",
      "profile-1",
      () => Promise.reject(new Error("binding unavailable")),
    );

    expect(result).toMatchObject({
      success: true,
      published: true,
      moderationOutcome: "error",
    });
    expect(setProfile).toHaveBeenCalledWith(
      expect.objectContaining({
        status: "PUBLISHED",
        moderationOutcome: "error",
        moderationReviewRequired: true,
      }),
    );
  });

  it("rejects a missing or already-published profile", async () => {
    const missing = moderationDb(null);
    expect(
      await publishProfile(missing.db as never, "user-1", "profile-1"),
    ).toMatchObject({ success: false, error: "Profile not found" });

    const published = moderationDb({
      ...draftProfile,
      status: "PUBLISHED",
      publishedAt: new Date("2026-01-01"),
    });
    expect(
      await publishProfile(published.db as never, "user-1", "profile-1"),
    ).toMatchObject({
      success: false,
      error: "Only a draft profile can be published",
    });
  });
});

describe("published profile edits", () => {
  const current = {
    handle: "existing-user",
    publishedAt: new Date("2026-01-01"),
    status: "PUBLISHED" as const,
    githubLogin: "existing-user",
    publicName: "Checked Public Name",
    publicAvatarUrl: "/api/avatar/avatars/user-1/checked.webp",
    user: { name: "Mutable Account Name", image: null },
  };

  it("keeps the previous public fields live when an edit is held", async () => {
    const setProfile = vi.fn();
    const updateProfile = vi.fn();
    const db = mockDb({
      findProfileForLock: current,
      findProfileByHandle: { id: "profile-1" },
      setProfile,
      updateProfile,
    });
    const checkContent = vi.fn().mockResolvedValue({
      outcome: "hold",
      flags: ["contains_contact_details"],
      scores: { contains_contact_details: 0.99 },
    });
    const result = await saveProfile(
      db as never,
      "user-1",
      makeFormData({ handle: "existing-user", bio: "email me@example.com" }),
      "profile-1",
      checkContent,
    );

    expect(result).toMatchObject({ success: false, moderationOutcome: "hold" });
    expect(setProfile).toHaveBeenCalledWith(
      expect.objectContaining({
        moderationOutcome: "hold",
        moderationReviewRequired: true,
      }),
    );
    expect(setProfile.mock.calls[0]?.[0]).not.toHaveProperty("bio");
    expect(checkContent).toHaveBeenCalledWith(
      expect.objectContaining({ displayName: "Checked Public Name" }),
      "/api/avatar/avatars/user-1/checked.webp",
    );
    expectStatusWriteGuard(updateProfile, "PUBLISHED");
  });

  it("publishes a passing edit and fails open on an unavailable check", async () => {
    const cases = [
      [
        "pass",
        () =>
          Promise.resolve({ outcome: "pass" as const, flags: [], scores: {} }),
        false,
      ],
      ["error", () => Promise.reject(new Error("binding unavailable")), true],
    ] as const;

    for (const [outcome, check, reviewRequired] of cases) {
      const setProfile = vi.fn();
      const db = mockDb({
        findProfileForLock: current,
        findProfileByHandle: { id: "profile-1" },
        setProfile,
      });
      const result = await saveProfile(
        db as never,
        "user-1",
        makeFormData({ handle: "existing-user", headline: "Updated headline" }),
        "profile-1",
        check,
      );

      expect(result).toMatchObject({
        success: true,
        published: true,
        moderationOutcome: outcome,
      });
      expect(setProfile).toHaveBeenCalledWith(
        expect.objectContaining({
          headline: "Updated headline",
          moderationOutcome: outcome,
          moderationReviewRequired: reviewRequired,
        }),
      );
    }
  });
});
