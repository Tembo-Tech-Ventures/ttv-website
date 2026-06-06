const AVATAR_ROUTE_PREFIX = "/api/avatar/";
const AVATAR_OBJECT_PREFIX = "avatars";
const AVATAR_MAX_DIMENSION = 1024;
const AVATAR_OUTPUT_FORMAT = "image/webp" as const;
const MAX_AVATAR_UPLOAD_SIZE = 5 * 1024 * 1024;

type AvatarStorageEnv = Pick<Cloudflare.Env, "BUCKET" | "IMAGES">;

export class AvatarUploadError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AvatarUploadError";
  }
}

function assertImageFile(file: File) {
  if (!file.size) {
    throw new AvatarUploadError("Please choose an image to upload.");
  }

  if (file.size > MAX_AVATAR_UPLOAD_SIZE) {
    throw new AvatarUploadError("Profile photos must be 5 MB or smaller.");
  }

  if (!file.type.startsWith("image/") || file.type === "image/svg+xml") {
    throw new AvatarUploadError("Please upload a PNG, JPG, GIF, or WebP image.");
  }
}

export function extractAvatarObjectKey(imageUrl?: string | null) {
  if (!imageUrl) {
    return null;
  }

  try {
    const parsed = new URL(imageUrl, "https://ttv.local");

    if (!parsed.pathname.startsWith(AVATAR_ROUTE_PREFIX)) {
      return null;
    }

    return decodeURIComponent(parsed.pathname.slice(AVATAR_ROUTE_PREFIX.length));
  } catch {
    return null;
  }
}

export async function storeProfilePhoto(
  env: AvatarStorageEnv,
  params: {
    userId: string;
    file: File;
    previousImageUrl?: string | null;
  }
) {
  assertImageFile(params.file);

  const uploadBytes = await params.file.arrayBuffer();
  const uploadBlob = new Blob([uploadBytes], {
    type: params.file.type || "application/octet-stream",
  });

  try {
    await env.IMAGES.info(uploadBlob.stream());
  } catch {
    throw new AvatarUploadError("Please upload a valid image file.");
  }

  const transformedImage = await env.IMAGES
    .input(uploadBlob.stream())
    .transform({
      fit: "scale-down",
      width: AVATAR_MAX_DIMENSION,
      height: AVATAR_MAX_DIMENSION,
    })
    .output({
      format: AVATAR_OUTPUT_FORMAT,
      quality: 85,
    });

  const response = await transformedImage.response();
  const contentType =
    response.headers.get("content-type") ??
    (await transformedImage.contentType());
  const objectKey = `${AVATAR_OBJECT_PREFIX}/${params.userId}/${crypto.randomUUID()}.webp`;
  const storedBlob = await response.blob();

  await env.BUCKET.put(objectKey, storedBlob, {
    httpMetadata: {
      contentType,
    },
  });

  const previousObjectKey = extractAvatarObjectKey(params.previousImageUrl);
  if (previousObjectKey && previousObjectKey !== objectKey) {
    await env.BUCKET.delete(previousObjectKey);
  }

  return {
    contentType,
    imageUrl: `${AVATAR_ROUTE_PREFIX}${objectKey}`,
    objectKey,
  };
}
