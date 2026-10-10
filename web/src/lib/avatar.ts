const AVATAR_ROUTE_PREFIX = "/api/avatar/";
const AVATAR_OBJECT_PREFIX = "avatars";
const AVATAR_MAX_DIMENSION = 1024;
const AVATAR_OUTPUT_FORMAT = "image/webp" as const;
const MAX_AVATAR_UPLOAD_SIZE = 5 * 1024 * 1024;
const MAX_CLEF_AVATAR_SIZE = 4 * 1024 * 1024;
const CLEF_AVATAR_TYPES = new Set(["image/jpeg", "image/png", "image/webp"]);
const TRUSTED_EXTERNAL_AVATAR_HOSTS = new Set([
  "avatars.githubusercontent.com",
]);

type AvatarStorageEnv = Pick<Cloudflare.Env, "BUCKET" | "IMAGES">;

export class AvatarUploadError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AvatarUploadError";
  }
}

function assertImageFile(file: File) {
  if (file.size === 0) {
    throw new AvatarUploadError("Please choose an image to upload.");
  }

  if (file.size > MAX_AVATAR_UPLOAD_SIZE) {
    throw new AvatarUploadError("Profile photos must be 5 MB or smaller.");
  }

  if (!file.type.startsWith("image/") || file.type === "image/svg+xml") {
    throw new AvatarUploadError(
      "Please upload a PNG, JPG, GIF, or WebP image.",
    );
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

    return decodeURIComponent(
      parsed.pathname.slice(AVATAR_ROUTE_PREFIX.length),
    );
  } catch {
    return null;
  }
}

function assertClefAvatar(contentType: string | undefined, size: number) {
  const normalizedType = contentType?.split(";", 1)[0]?.trim().toLowerCase();
  if (!normalizedType || !CLEF_AVATAR_TYPES.has(normalizedType)) {
    throw new Error("Unsupported profile image type");
  }
  if (size === 0 || size > MAX_CLEF_AVATAR_SIZE) {
    throw new Error("Profile image is outside the Clef size limit");
  }
  return normalizedType;
}

async function readBoundedResponse(response: Response): Promise<Uint8Array> {
  const declaredSize = Number(response.headers.get("content-length"));
  if (Number.isFinite(declaredSize) && declaredSize > MAX_CLEF_AVATAR_SIZE) {
    throw new Error("Profile image is outside the Clef size limit");
  }
  if (!response.body) throw new Error("Profile image has no body");

  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > MAX_CLEF_AVATAR_SIZE) {
      await reader.cancel();
      throw new Error("Profile image is outside the Clef size limit");
    }
    chunks.push(value);
  }

  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return bytes;
}

function base64Encode(bytes: Uint8Array): string {
  let binary = "";
  for (let offset = 0; offset < bytes.length; offset += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + 0x8000));
  }
  return btoa(binary);
}

function base64Decode(value: string): Uint8Array {
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return bytes;
}

export function safePublicProfileAvatarUrl(imageUrl?: string | null) {
  return extractAvatarObjectKey(imageUrl) ? (imageUrl ?? null) : null;
}

export async function storeModeratedProfilePhotoSnapshot(
  bucket: Pick<R2Bucket, "put">,
  userId: string,
  dataUrl: string,
): Promise<string> {
  const match =
    /^data:(image\/(?:jpeg|png|webp));base64,([A-Za-z0-9+/]+={0,2})$/.exec(
      dataUrl,
    );
  if (!match) throw new Error("Invalid moderated profile image");

  const contentType = match[1];
  const bytes = base64Decode(match[2]);
  assertClefAvatar(contentType, bytes.byteLength);
  const digest = new Uint8Array(
    await crypto.subtle.digest("SHA-256", Uint8Array.from(bytes).buffer),
  );
  const hash = Array.from(digest, (byte) =>
    byte.toString(16).padStart(2, "0"),
  ).join("");
  const extension =
    contentType === "image/jpeg" ? "jpg" : contentType.slice("image/".length);
  const objectKey = `${AVATAR_OBJECT_PREFIX}/${userId}/moderated/${hash}.${extension}`;

  await bucket.put(objectKey, bytes, { httpMetadata: { contentType } });
  return `${AVATAR_ROUTE_PREFIX}${objectKey}`;
}

export async function discardStoredProfilePhoto(
  bucket: Pick<R2Bucket, "delete">,
  userId: string,
  imageUrl?: string | null,
) {
  const objectKey = extractAvatarObjectKey(imageUrl);
  if (objectKey?.startsWith(`${AVATAR_OBJECT_PREFIX}/${userId}/`)) {
    await bucket.delete(objectKey);
  }
}

export async function loadProfilePhotoForModeration(
  bucket: Pick<R2Bucket, "get">,
  imageUrl: string | null | undefined,
  fetchImage: typeof fetch = fetch,
): Promise<string | null> {
  if (!imageUrl) return null;

  let bytes: Uint8Array;
  let contentType: string | undefined;
  if (imageUrl.startsWith(AVATAR_ROUTE_PREFIX)) {
    const objectKey = extractAvatarObjectKey(imageUrl);
    if (!objectKey) throw new Error("Invalid stored profile image");
    const object = await bucket.get(objectKey);
    if (!object) throw new Error("Stored profile image was not found");
    contentType = assertClefAvatar(
      object.httpMetadata?.contentType,
      object.size,
    );
    bytes = await object.bytes();
  } else {
    const remoteUrl = new URL(imageUrl);
    if (
      remoteUrl.protocol !== "https:" ||
      !TRUSTED_EXTERNAL_AVATAR_HOSTS.has(remoteUrl.hostname)
    ) {
      throw new Error("Untrusted external profile image");
    }
    const response = await fetchImage(remoteUrl, { redirect: "error" });
    if (!response.ok) throw new Error("External profile image was unavailable");
    bytes = await readBoundedResponse(response);
    contentType = assertClefAvatar(
      response.headers.get("content-type") ?? undefined,
      bytes.byteLength,
    );
  }

  if (bytes.byteLength > MAX_CLEF_AVATAR_SIZE) {
    throw new Error("Profile image is outside the Clef size limit");
  }
  return `data:${contentType};base64,${base64Encode(bytes)}`;
}

export async function storeProfilePhoto(
  env: AvatarStorageEnv,
  params: {
    userId: string;
    file: File;
    previousImageUrl?: string | null;
    deletePrevious?: boolean;
  },
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

  const transformedImage = await env.IMAGES.input(uploadBlob.stream())
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
  if (
    params.deletePrevious !== false &&
    previousObjectKey?.startsWith(
      `${AVATAR_OBJECT_PREFIX}/${params.userId}/`,
    ) &&
    previousObjectKey !== objectKey
  ) {
    await env.BUCKET.delete(previousObjectKey);
  }

  return {
    contentType,
    imageUrl: `${AVATAR_ROUTE_PREFIX}${objectKey}`,
    objectKey,
  };
}
