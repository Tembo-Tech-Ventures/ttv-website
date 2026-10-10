import { describe, expect, it, vi } from "vitest";
import {
  discardReplacedProfilePhotos,
  discardUnreferencedProfilePhoto,
} from "./profile-photo-cleanup";
import {
  extractAvatarObjectKey,
  storeModeratedProfilePhotoSnapshot,
} from "@/lib/avatar";

const oldAvatar = "/api/avatar/avatars/user-1/old.webp";
const candidateAvatar = "/api/avatar/avatars/user-1/candidate.webp";

function cleanupContext({
  accountImage = candidateAvatar,
  publicAvatarUrl = null,
  queryError = false,
}: {
  accountImage?: string | null;
  publicAvatarUrl?: string | null;
  queryError?: boolean;
} = {}) {
  const findUser = queryError
    ? vi.fn().mockRejectedValue(new Error("database unavailable"))
    : vi.fn().mockResolvedValue({ image: accountImage });
  const findProfile = vi.fn().mockResolvedValue({ publicAvatarUrl });
  const deleteObject = vi.fn().mockResolvedValue(undefined);

  return {
    db: {
      query: {
        user: { findFirst: findUser },
        studentProfile: { findFirst: findProfile },
      },
    },
    bucket: { delete: deleteObject },
    deleteObject,
  };
}

describe("discardUnreferencedProfilePhoto", () => {
  it("preserves the old object when a concurrent suspension still snapshots it", async () => {
    const { db, bucket, deleteObject } = cleanupContext({
      accountImage: candidateAvatar,
      publicAvatarUrl: oldAvatar,
    });

    await expect(
      discardUnreferencedProfilePhoto({
        db: db as never,
        bucket: bucket as never,
        userId: "user-1",
        imageUrl: oldAvatar,
      }),
    ).resolves.toBe(false);
    expect(deleteObject).not.toHaveBeenCalled();
  });

  it("preserves an uploaded candidate that a partial identity write references", async () => {
    const { db, bucket, deleteObject } = cleanupContext({
      accountImage: candidateAvatar,
      publicAvatarUrl: oldAvatar,
    });

    await expect(
      discardUnreferencedProfilePhoto({
        db: db as never,
        bucket: bucket as never,
        userId: "user-1",
        imageUrl: candidateAvatar,
      }),
    ).resolves.toBe(false);
    expect(deleteObject).not.toHaveBeenCalled();
  });

  it("deletes an uploaded candidate after confirming it is unreferenced", async () => {
    const { db, bucket, deleteObject } = cleanupContext({
      accountImage: oldAvatar,
      publicAvatarUrl: oldAvatar,
    });

    await expect(
      discardUnreferencedProfilePhoto({
        db: db as never,
        bucket: bucket as never,
        userId: "user-1",
        imageUrl: candidateAvatar,
      }),
    ).resolves.toBe(true);
    expect(deleteObject).toHaveBeenCalledWith("avatars/user-1/candidate.webp");
  });

  it("deletes an unreferenced moderated snapshot after a profile write loses its version race", async () => {
    const moderatedCandidate =
      "/api/avatar/avatars/user-1/moderated/candidate.webp";
    const { db, bucket, deleteObject } = cleanupContext({
      accountImage: oldAvatar,
      publicAvatarUrl: oldAvatar,
    });

    await expect(
      discardUnreferencedProfilePhoto({
        db: db as never,
        bucket: bucket as never,
        userId: "user-1",
        imageUrl: moderatedCandidate,
      }),
    ).resolves.toBe(true);
    expect(deleteObject).toHaveBeenCalledWith(
      "avatars/user-1/moderated/candidate.webp",
    );
  });

  it("cannot delete a concurrent winner's same-content moderated snapshot", async () => {
    const objects = new Set<string>();
    const bucket = {
      put: vi.fn(async (key: string) => {
        objects.add(key);
      }),
      delete: vi.fn(async (key: string) => {
        objects.delete(key);
      }),
    };
    const loserSnapshot = await storeModeratedProfilePhotoSnapshot(
      bucket as never,
      "user-1",
      "data:image/png;base64,AQID",
    );
    const winnerSnapshot = await storeModeratedProfilePhotoSnapshot(
      bucket as never,
      "user-1",
      "data:image/png;base64,AQID",
    );
    const winnerKey = extractAvatarObjectKey(winnerSnapshot);
    expect(winnerSnapshot).not.toBe(loserSnapshot);
    expect(winnerKey).not.toBeNull();

    const db = {
      query: {
        user: {
          findFirst: vi.fn().mockResolvedValue({ image: oldAvatar }),
        },
        studentProfile: {
          // These reads represent the losing request observing the old row.
          // The winning request may adopt its distinct object immediately
          // afterwards without sharing the loser's deletion target.
          findFirst: vi
            .fn()
            .mockResolvedValue({ publicAvatarUrl: oldAvatar }),
        },
      },
    };

    await expect(
      discardUnreferencedProfilePhoto({
        db: db as never,
        bucket: bucket as never,
        userId: "user-1",
        imageUrl: loserSnapshot,
      }),
    ).resolves.toBe(true);

    expect(objects.has(extractAvatarObjectKey(loserSnapshot)!)).toBe(false);
    expect(objects.has(winnerKey!)).toBe(true);
  });

  it("fails closed on lookup errors and never deletes an uncertain object", async () => {
    const { db, bucket, deleteObject } = cleanupContext({ queryError: true });

    await expect(
      discardUnreferencedProfilePhoto({
        db: db as never,
        bucket: bucket as never,
        userId: "user-1",
        imageUrl: candidateAvatar,
      }),
    ).resolves.toBe(false);
    expect(deleteObject).not.toHaveBeenCalled();
  });

  it("cleans both replaced account and moderated public snapshots", async () => {
    const accountAvatar = "/api/avatar/avatars/user-1/account-old.webp";
    const moderatedAvatar =
      "/api/avatar/avatars/user-1/moderated/checked-old.webp";
    const { db, bucket, deleteObject } = cleanupContext({
      accountImage: candidateAvatar,
      publicAvatarUrl: candidateAvatar,
    });

    await discardReplacedProfilePhotos({
      db: db as never,
      bucket: bucket as never,
      userId: "user-1",
      imageUrls: [accountAvatar, moderatedAvatar],
    });

    expect(deleteObject).toHaveBeenCalledTimes(2);
    expect(deleteObject).toHaveBeenCalledWith(
      "avatars/user-1/account-old.webp",
    );
    expect(deleteObject).toHaveBeenCalledWith(
      "avatars/user-1/moderated/checked-old.webp",
    );
  });

  it("deduplicates a held-draft snapshot shared with the account", async () => {
    const { db, bucket, deleteObject } = cleanupContext({
      accountImage: candidateAvatar,
      publicAvatarUrl: candidateAvatar,
    });

    await discardReplacedProfilePhotos({
      db: db as never,
      bucket: bucket as never,
      userId: "user-1",
      imageUrls: [oldAvatar, oldAvatar],
    });

    expect(deleteObject).toHaveBeenCalledOnce();
  });
});
