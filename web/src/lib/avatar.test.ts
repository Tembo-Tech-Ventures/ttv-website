import { describe, expect, it, vi } from "vitest";
import {
  discardStoredProfilePhoto,
  extractAvatarObjectKey,
  loadProfilePhotoForModeration,
  safePublicProfileAvatarUrl,
  storeModeratedProfilePhotoSnapshot,
  storeProfilePhoto,
} from "./avatar";

function createMockImages() {
  const transform = vi.fn().mockReturnValue({
    output: vi.fn().mockResolvedValue({
      response: vi.fn().mockResolvedValue(
        new Response(new Uint8Array([1, 2, 3]), {
          headers: { "content-type": "image/webp" },
        }),
      ),
      contentType: vi.fn().mockResolvedValue("image/webp"),
    }),
  });

  return {
    info: vi.fn().mockResolvedValue({
      format: "image/png",
      fileSize: 1234,
      width: 1800,
      height: 1200,
    }),
    input: vi.fn().mockReturnValue({
      transform,
    }),
    __transform: transform,
  };
}

describe("avatar uploads", () => {
  it("stores a resized avatar in R2 and removes the previous avatar", async () => {
    const images = createMockImages();
    const bucket = {
      put: vi.fn().mockResolvedValue({}),
      delete: vi.fn().mockResolvedValue({}),
    };
    const file = new File([new Uint8Array([9, 8, 7])], "avatar.png", {
      type: "image/png",
    });

    const result = await storeProfilePhoto(
      {
        BUCKET: bucket as never,
        IMAGES: images as never,
      },
      {
        userId: "user_123",
        file,
        previousImageUrl: "/api/avatar/avatars/user_123/old.webp",
      },
    );

    expect(images.info).toHaveBeenCalledTimes(1);
    expect(images.input).toHaveBeenCalledTimes(1);
    expect(images.__transform).toHaveBeenCalledWith({
      fit: "scale-down",
      width: 1024,
      height: 1024,
    });
    expect(bucket.put).toHaveBeenCalledTimes(1);

    const [storedKey, storedBlob, storedOptions] = bucket.put.mock.calls[0];
    expect(storedKey).toMatch(/^avatars\/user_123\/.+\.webp$/);
    expect(storedBlob).toBeInstanceOf(Blob);
    expect(storedOptions).toEqual({
      httpMetadata: {
        contentType: "image/webp",
      },
    });
    expect(bucket.delete).toHaveBeenCalledWith("avatars/user_123/old.webp");
    expect(result.imageUrl).toMatch(
      /^\/api\/avatar\/avatars\/user_123\/.+\.webp$/,
    );
    expect(result.contentType).toBe("image/webp");
    expect(extractAvatarObjectKey(result.imageUrl)).toMatch(
      /^avatars\/user_123\/.+\.webp$/,
    );
  });

  it("rejects non-image uploads", async () => {
    const images = createMockImages();
    const bucket = {
      put: vi.fn(),
      delete: vi.fn(),
    };
    const file = new File([new Uint8Array([1, 2, 3])], "notes.txt", {
      type: "text/plain",
    });

    await expect(
      storeProfilePhoto(
        {
          BUCKET: bucket as never,
          IMAGES: images as never,
        },
        {
          userId: "user_123",
          file,
        },
      ),
    ).rejects.toThrow("Please upload a PNG, JPG, GIF, or WebP image.");

    expect(bucket.put).not.toHaveBeenCalled();
  });

  it("can retain the previous image while a published replacement is checked", async () => {
    const bucket = {
      put: vi.fn().mockResolvedValue({}),
      delete: vi.fn().mockResolvedValue({}),
    };
    await storeProfilePhoto(
      { BUCKET: bucket as never, IMAGES: createMockImages() as never },
      {
        userId: "user_123",
        file: new File([new Uint8Array([1])], "avatar.png", {
          type: "image/png",
        }),
        previousImageUrl: "/api/avatar/avatars/user_123/old.webp",
        deletePrevious: false,
      },
    );

    expect(bucket.delete).not.toHaveBeenCalled();
  });
});

describe("avatar moderation input", () => {
  it("embeds a stored profile image as a Clef data URL", async () => {
    const bucket = {
      get: vi.fn().mockResolvedValue({
        size: 3,
        httpMetadata: { contentType: "image/webp" },
        bytes: vi.fn().mockResolvedValue(new Uint8Array([9, 8, 7])),
      }),
    };

    await expect(
      loadProfilePhotoForModeration(
        bucket as never,
        "/api/avatar/avatars/user_123/photo.webp",
      ),
    ).resolves.toBe("data:image/webp;base64,CQgH");
    expect(bucket.get).toHaveBeenCalledWith("avatars/user_123/photo.webp");
  });

  it("loads only trusted external GitHub avatars", async () => {
    const fetchImage = vi.fn().mockResolvedValue(
      new Response(new Uint8Array([1, 2, 3]), {
        headers: { "content-type": "image/png" },
      }),
    );

    await expect(
      loadProfilePhotoForModeration(
        { get: vi.fn() } as never,
        "https://avatars.githubusercontent.com/u/123?v=4",
        fetchImage,
      ),
    ).resolves.toBe("data:image/png;base64,AQID");
    await expect(
      loadProfilePhotoForModeration(
        { get: vi.fn() } as never,
        "https://example.com/avatar.png",
        fetchImage,
      ),
    ).rejects.toThrow("Untrusted external profile image");
    expect(fetchImage).toHaveBeenCalledTimes(1);
  });

  it("rejects images outside Clef's supported types and size limit", async () => {
    const unsupported = {
      get: vi.fn().mockResolvedValue({
        size: 3,
        httpMetadata: { contentType: "image/gif" },
        bytes: vi.fn(),
      }),
    };
    await expect(
      loadProfilePhotoForModeration(
        unsupported as never,
        "/api/avatar/avatars/user_123/photo.gif",
      ),
    ).rejects.toThrow("Unsupported profile image type");

    const oversized = {
      get: vi.fn().mockResolvedValue({
        size: 4 * 1024 * 1024 + 1,
        httpMetadata: { contentType: "image/webp" },
        bytes: vi.fn(),
      }),
    };
    await expect(
      loadProfilePhotoForModeration(
        oversized as never,
        "/api/avatar/avatars/user_123/photo.webp",
      ),
    ).rejects.toThrow("Profile image is outside the Clef size limit");
  });

  it("stores external checked bytes at a content-addressed local URL", async () => {
    const bucket = { put: vi.fn().mockResolvedValue({}) };
    const first = await storeModeratedProfilePhotoSnapshot(
      bucket as never,
      "user_123",
      "data:image/png;base64,AQID",
    );
    const second = await storeModeratedProfilePhotoSnapshot(
      bucket as never,
      "user_123",
      "data:image/png;base64,AQID",
    );

    expect(first).toBe(second);
    expect(first).toMatch(
      /^\/api\/avatar\/avatars\/user_123\/moderated\/[a-f0-9]{64}\.png$/,
    );
    expect(bucket.put).toHaveBeenCalledWith(
      expect.stringMatching(/^avatars\/user_123\/moderated\//),
      new Uint8Array([1, 2, 3]),
      { httpMetadata: { contentType: "image/png" } },
    );
    expect(safePublicProfileAvatarUrl(first)).toBe(first);
    expect(
      safePublicProfileAvatarUrl("https://avatars.githubusercontent.com/u/123"),
    ).toBeNull();
  });

  it("only discards avatar objects owned by the user", async () => {
    const bucket = { delete: vi.fn().mockResolvedValue({}) };
    await discardStoredProfilePhoto(
      bucket as never,
      "user_123",
      "/api/avatar/avatars/user_123/candidate.webp",
    );
    await discardStoredProfilePhoto(
      bucket as never,
      "user_123",
      "/api/avatar/avatars/another-user/photo.webp",
    );

    expect(bucket.delete).toHaveBeenCalledTimes(1);
    expect(bucket.delete).toHaveBeenCalledWith(
      "avatars/user_123/candidate.webp",
    );
  });
});
