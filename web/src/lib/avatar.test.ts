import { describe, expect, it, vi } from "vitest";
import { extractAvatarObjectKey, storeProfilePhoto } from "./avatar";

function createMockImages() {
  const transform = vi.fn().mockReturnValue({
    output: vi.fn().mockResolvedValue({
      response: vi.fn().mockReturnValue(
        new Response(new Uint8Array([1, 2, 3]), {
          headers: { "content-type": "image/webp" },
        })
      ),
      contentType: vi.fn().mockReturnValue("image/webp"),
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
      }
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
    expect(result.imageUrl).toMatch(/^\/api\/avatar\/avatars\/user_123\/.+\.webp$/);
    expect(result.contentType).toBe("image/webp");
    expect(extractAvatarObjectKey(result.imageUrl)).toMatch(
      /^avatars\/user_123\/.+\.webp$/
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
        }
      )
    ).rejects.toThrow("Please upload a PNG, JPG, GIF, or WebP image.");

    expect(bucket.put).not.toHaveBeenCalled();
  });
});
