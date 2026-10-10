import { describe, expect, it, vi } from "vitest";
import { SQLiteSyncDialect } from "drizzle-orm/sqlite-core";
import * as schema from "@/lib/db/schema";
import { saveProfileIdentity } from "./profile-handlers";

const publishedProfile = {
  id: "profile-1",
  status: "PUBLISHED" as const,
  handle: "builder",
  headline: "Developer",
  bio: "I build useful tools.",
  location: "Lagos",
  country: "Nigeria",
  skills: '["TypeScript"]',
  githubLogin: "builder",
  portfolioUrl: null,
  linkedinUrl: null,
  publicName: "Old Name",
  publicAvatarUrl: "/api/avatar/avatars/user-1/old.webp",
  user: {
    name: "Old Name",
    image: "/api/avatar/avatars/user-1/old.webp",
  },
};

type TestProfile = Omit<typeof publishedProfile, "status"> & {
  status: "DRAFT" | "PUBLISHED" | "SUSPENDED";
};

function mockDb(profile: TestProfile | null, profileChanges = 1) {
  const setProfile = vi.fn();
  const setUser = vi.fn();
  const profileWhere = vi
    .fn()
    .mockReturnValue({ meta: { changes: profileChanges } });
  const userWhere = vi.fn().mockReturnValue({ meta: { changes: 1 } });
  return {
    db: {
      query: {
        studentProfile: { findFirst: vi.fn().mockResolvedValue(profile) },
      },
      update: vi.fn((table: unknown) => ({
        set: vi.fn((values: unknown) => {
          if (table === schema.studentProfile) {
            setProfile(values);
            return { where: profileWhere };
          }
          setUser(values);
          return { where: userWhere };
        }),
      })),
    },
    setProfile,
    setUser,
    profileWhere,
  };
}

function expectPublishedGuard(where: ReturnType<typeof vi.fn>) {
  const query = new SQLiteSyncDialect().sqlToQuery(where.mock.calls[0][0]);
  expect(query.sql).toContain('"studentProfile"."status" = ?');
  expect(query.params).toContain("PUBLISHED");
}

describe("saveProfileIdentity", () => {
  it("publishes a passing name change through the checked identity snapshot", async () => {
    const { db, setProfile, setUser, profileWhere } = mockDb(publishedProfile);
    const check = vi.fn().mockResolvedValue({
      outcome: "pass",
      flags: [],
      scores: {},
    });

    const result = await saveProfileIdentity(
      db as never,
      "user-1",
      { name: "New Name" },
      check,
    );

    expect(result).toMatchObject({
      success: true,
      published: true,
      moderationOutcome: "pass",
    });
    expect(check).toHaveBeenCalledWith(
      expect.objectContaining({ displayName: "New Name", handle: "builder" }),
      "/api/avatar/avatars/user-1/old.webp",
    );
    expect(setProfile).toHaveBeenCalledWith(
      expect.objectContaining({
        publicName: "New Name",
        publicAvatarUrl: "/api/avatar/avatars/user-1/old.webp",
        moderationOutcome: "pass",
        moderationReviewRequired: false,
      }),
    );
    expect(setUser).toHaveBeenCalledWith({ name: "New Name" });
    expectPublishedGuard(profileWhere);
  });

  it("keeps the prior public identity when an avatar change is held", async () => {
    const { db, setProfile, setUser } = mockDb(publishedProfile);
    const result = await saveProfileIdentity(
      db as never,
      "user-1",
      { avatarUrl: "/api/avatar/avatars/user-1/candidate.webp" },
      () =>
        Promise.resolve({
          outcome: "hold",
          flags: ["impersonation_risk"],
          scores: { impersonation_risk: 0.93 },
        }),
    );

    expect(result).toMatchObject({
      success: false,
      moderationOutcome: "hold",
      moderationMessages: [
        "Remove claims that you represent TTV or another organisation unless that role is accurate.",
      ],
    });
    expect(setProfile).toHaveBeenCalledWith(
      expect.objectContaining({
        moderationOutcome: "hold",
        moderationReviewRequired: true,
      }),
    );
    expect(setProfile.mock.calls[0][0]).not.toHaveProperty("publicAvatarUrl");
    expect(setUser).not.toHaveBeenCalled();
  });

  it("fails open on a check error and flags the new identity for review", async () => {
    const { db, setProfile, setUser } = mockDb(publishedProfile);
    const result = await saveProfileIdentity(
      db as never,
      "user-1",
      { name: "New Name" },
      () => Promise.reject(new Error("AI unavailable")),
    );

    expect(result).toMatchObject({
      success: true,
      published: true,
      moderationOutcome: "error",
    });
    expect(setProfile).toHaveBeenCalledWith(
      expect.objectContaining({
        publicName: "New Name",
        moderationOutcome: "error",
        moderationReviewRequired: true,
      }),
    );
    expect(setUser).toHaveBeenCalledWith({ name: "New Name" });
  });

  it("does not update account identity after losing the published-status race", async () => {
    const { db, setUser, profileWhere } = mockDb(publishedProfile, 0);
    const result = await saveProfileIdentity(
      db as never,
      "user-1",
      { name: "New Name" },
      () => Promise.resolve({ outcome: "pass", flags: [], scores: {} }),
    );

    expect(result).toEqual({
      success: false,
      error:
        "This profile changed while your request was running. Reload and try again.",
    });
    expect(setUser).not.toHaveBeenCalled();
    expectPublishedGuard(profileWhere);
  });

  it("clears a held draft decision when private identity changes", async () => {
    const { db, setProfile, setUser } = mockDb({
      ...publishedProfile,
      status: "DRAFT",
    });
    const check = vi.fn();

    const result = await saveProfileIdentity(
      db as never,
      "user-1",
      { name: "Draft Name" },
      check,
    );

    expect(result).toEqual({ success: true });
    expect(check).not.toHaveBeenCalled();
    expect(setProfile).toHaveBeenCalledWith(
      expect.objectContaining({
        publicName: null,
        publicAvatarUrl: null,
        moderationOutcome: null,
        moderationReviewRequired: false,
      }),
    );
    expect(setUser).toHaveBeenCalledWith({ name: "Draft Name" });
  });
});
