import { sql } from "drizzle-orm";
import { describe, expect, it, vi } from "vitest";
import { SQLiteSyncDialect } from "drizzle-orm/sqlite-core";
import * as schema from "@/lib/db/schema";
import { saveProfileIdentity } from "./profile-handlers";

const publishedProfile = {
  id: "profile-1",
  status: "PUBLISHED" as const,
  contentVersion: 4,
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
  highlights: [],
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
  const userWhere = vi
    .fn()
    .mockReturnValue({ meta: { changes: profileChanges } });
  const batch = vi.fn(async (queries: unknown[]) => queries);
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
      select: vi.fn(() => ({
        from: vi.fn(() => ({ where: vi.fn(() => sql`1`) })),
      })),
      batch,
    },
    setProfile,
    setUser,
    profileWhere,
    batch,
  };
}

function expectVersionedStatusGuard(
  where: ReturnType<typeof vi.fn>,
  status: "DRAFT" | "PUBLISHED",
) {
  const query = new SQLiteSyncDialect().sqlToQuery(where.mock.calls[0][0]);
  expect(query.sql).toContain('"studentProfile"."status" = ?');
  expect(query.params).toContain(status);
  expect(query.sql).toContain('"studentProfile"."contentVersion" = ?');
  expect(query.params.at(-1)).toBe(4);
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
    expectVersionedStatusGuard(profileWhere, "PUBLISHED");
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

  it("rejects a delayed name check after a concurrent avatar version wins", async () => {
    const { db, batch, profileWhere } = mockDb(publishedProfile, 0);
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
    expect(batch).toHaveBeenCalledOnce();
    expectVersionedStatusGuard(profileWhere, "PUBLISHED");
  });

  it("lets only one checked identity update win a deterministic interleaving", async () => {
    let persistedVersion = publishedProfile.contentVersion;
    let persistedName = publishedProfile.user.name;
    let releaseFirstCheck!: () => void;
    let markFirstCheckStarted!: () => void;
    const firstCheckStarted = new Promise<void>((resolve) => {
      markFirstCheckStarted = resolve;
    });
    const firstCheckCanFinish = new Promise<void>((resolve) => {
      releaseFirstCheck = resolve;
    });

    interface PendingWrite {
      table: unknown;
      values: Record<string, unknown>;
    }

    const db = {
      query: {
        studentProfile: {
          findFirst: vi.fn(async () => ({ ...publishedProfile })),
        },
      },
      update: vi.fn((table: unknown) => ({
        set: (values: Record<string, unknown>) => ({
          where: (_condition: unknown): PendingWrite => ({ table, values }),
        }),
      })),
      select: vi.fn(() => ({
        from: vi.fn(() => ({ where: vi.fn(() => sql`1`) })),
      })),
      batch: vi.fn(async (writes: PendingWrite[]) => {
        const wins = persistedVersion === publishedProfile.contentVersion;
        if (wins) {
          const userWrite = writes.find((write) => write.table === schema.user);
          persistedName = String(userWrite?.values.name);
          persistedVersion += 1;
        }
        return writes.map(() => ({ meta: { changes: wins ? 1 : 0 } }));
      }),
    };
    const pass = { outcome: "pass" as const, flags: [], scores: {} };

    const delayed = saveProfileIdentity(
      db as never,
      "user-1",
      { name: "Delayed Name" },
      async () => {
        markFirstCheckStarted();
        await firstCheckCanFinish;
        return pass;
      },
    );
    await firstCheckStarted;
    const winner = await saveProfileIdentity(
      db as never,
      "user-1",
      { name: "Winning Name" },
      () => Promise.resolve(pass),
    );
    releaseFirstCheck();
    const loser = await delayed;

    expect(winner).toMatchObject({ success: true });
    expect(loser).toEqual({
      success: false,
      error:
        "This profile changed while your request was running. Reload and try again.",
    });
    expect(persistedVersion).toBe(5);
    expect(persistedName).toBe("Winning Name");
  });

  it("queues the checked identity and version change in one atomic batch", async () => {
    const { db, batch } = mockDb(publishedProfile);
    let checkFinished = false;

    const result = await saveProfileIdentity(
      db as never,
      "user-1",
      { avatarUrl: "/api/avatar/avatars/user-1/new.webp" },
      async () => {
        checkFinished = true;
        return { outcome: "pass", flags: [], scores: {} };
      },
    );

    expect(result.success).toBe(true);
    expect(checkFinished).toBe(true);
    expect(batch).toHaveBeenCalledOnce();
    expect(batch.mock.calls[0][0]).toHaveLength(2);
  });

  it("surfaces an atomic batch failure without running a second write", async () => {
    const { db, batch } = mockDb(publishedProfile);
    batch.mockRejectedValueOnce(new Error("D1 batch failed"));

    await expect(
      saveProfileIdentity(db as never, "user-1", { name: "New Name" }, () =>
        Promise.resolve({ outcome: "pass", flags: [], scores: {} }),
      ),
    ).rejects.toThrow("D1 batch failed");
    expect(batch).toHaveBeenCalledOnce();
  });

  it("clears a held draft decision when private identity changes", async () => {
    const { db, setProfile, setUser, profileWhere } = mockDb({
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
    expectVersionedStatusGuard(profileWhere, "DRAFT");
  });
});
