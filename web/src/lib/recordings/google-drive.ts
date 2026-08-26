import type { GoogleDriveCredentials } from "@/lib/credentials/google-drive";

export type { GoogleDriveCredentials };

export interface GoogleDriveVideoFile {
  id: string;
  name: string;
  mimeType: string;
  sizeBytes?: number;
  createdAt?: Date;
  modifiedAt?: Date;
}

const DRIVE_READONLY_SCOPE =
  "https://www.googleapis.com/auth/drive.readonly";
const GOOGLE_TOKEN_ENDPOINT = "https://oauth2.googleapis.com/token";
const GOOGLE_DRIVE_FILES_ENDPOINT =
  "https://www.googleapis.com/drive/v3/files";
const DRIVE_FOLDER_ID_PATTERN = /^[A-Za-z0-9_-]{10,}$/;
const DRIVE_FOLDER_MIME_TYPE = "application/vnd.google-apps.folder";
const DRIVE_SHORTCUT_MIME_TYPE = "application/vnd.google-apps.shortcut";

let tokenCache:
  | { cacheKey: string; accessToken: string; expiresAt: number }
  | undefined;

function assertDriveFolderId(value: string): string {
  if (!DRIVE_FOLDER_ID_PATTERN.test(value)) {
    throw new Error("Enter a valid Google Drive folder URL or folder ID.");
  }
  return value;
}

export function parseGoogleDriveFolderId(input: string): string {
  const value = input.trim();
  if (!value) {
    throw new Error("Google Drive folder is required.");
  }

  if (!value.includes("://")) {
    return assertDriveFolderId(value);
  }

  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error("Enter a valid Google Drive folder URL or folder ID.");
  }

  const pathParts = url.pathname.split("/").filter(Boolean);
  const folderIndex = pathParts.indexOf("folders");
  const folderId =
    folderIndex >= 0 ? pathParts[folderIndex + 1] : url.searchParams.get("id");

  return assertDriveFolderId(folderId ?? "");
}

function bytesToBase64Url(bytes: Uint8Array): string {
  let binary = "";
  for (let index = 0; index < bytes.length; index += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(index, index + 0x8000));
  }
  return btoa(binary)
    .replace(/=/g, "")
    .replace(/\+/g, "-")
    .replace(/\//g, "_");
}

function textToBase64Url(value: unknown): string {
  return bytesToBase64Url(
    new TextEncoder().encode(JSON.stringify(value))
  );
}

function privateKeyToPkcs8(privateKey: string): ArrayBuffer {
  const encoded = privateKey
    .replace(/-----BEGIN PRIVATE KEY-----/g, "")
    .replace(/-----END PRIVATE KEY-----/g, "")
    .replace(/\s/g, "");

  if (!encoded) {
    throw new Error("The Google Drive service-account private key is empty.");
  }

  try {
    const binary = atob(encoded);
    return Uint8Array.from(binary, (character) => character.charCodeAt(0))
      .buffer;
  } catch {
    throw new Error("The Google Drive service-account private key is invalid.");
  }
}

export async function createGoogleServiceAccountAssertion(
  credentials: GoogleDriveCredentials,
  now = Date.now()
): Promise<string> {
  const issuedAt = Math.floor(now / 1000);
  const header = {
    alg: "RS256",
    typ: "JWT",
    ...(credentials.privateKeyId ? { kid: credentials.privateKeyId } : {}),
  };
  const claims = {
    iss: credentials.clientEmail,
    scope: DRIVE_READONLY_SCOPE,
    aud: GOOGLE_TOKEN_ENDPOINT,
    iat: issuedAt,
    exp: issuedAt + 3600,
    ...(credentials.impersonatedUser
      ? { sub: credentials.impersonatedUser }
      : {}),
  };
  const unsigned = `${textToBase64Url(header)}.${textToBase64Url(claims)}`;
  const key = await crypto.subtle.importKey(
    "pkcs8",
    privateKeyToPkcs8(credentials.privateKey),
    { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const signature = await crypto.subtle.sign(
    "RSASSA-PKCS1-v1_5",
    key,
    new TextEncoder().encode(unsigned)
  );

  return `${unsigned}.${bytesToBase64Url(new Uint8Array(signature))}`;
}

async function responseError(
  response: Response,
  operation: string
): Promise<Error> {
  let code: string | undefined;
  try {
    const body = (await response.json()) as {
      error?: { errors?: Array<{ reason?: string }> };
    };
    code = body?.error?.errors?.[0]?.reason;
  } catch {
    // fall through
  }
  const suffix = code ? `: ${code}` : "";
  return new Error(
    `${operation} failed with HTTP ${response.status}${suffix}`
  );
}

export async function getGoogleDriveAccessToken(
  credentials: GoogleDriveCredentials,
  options: {
    fetch?: typeof fetch;
    now?: number;
    useCache?: boolean;
  } = {}
): Promise<string> {
  const now = options.now ?? Date.now();
  const cacheKey = `${credentials.privateKeyId ?? ""}:${credentials.clientEmail}:${credentials.impersonatedUser ?? ""}`;
  if (
    options.useCache !== false &&
    tokenCache?.cacheKey === cacheKey &&
    tokenCache.expiresAt > now + 60_000
  ) {
    return tokenCache.accessToken;
  }

  const assertion = await createGoogleServiceAccountAssertion(credentials, now);
  const response = await (options.fetch ?? fetch)(GOOGLE_TOKEN_ENDPOINT, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion,
    }),
  });
  if (!response.ok) {
    throw await responseError(response, "Google OAuth token request");
  }

  const result = (await response.json()) as {
    access_token?: unknown;
    expires_in?: unknown;
  };
  if (typeof result.access_token !== "string") {
    throw new TypeError("Google OAuth token response did not include an access token.");
  }

  const expiresIn =
    typeof result.expires_in === "number" ? result.expires_in : 3600;
  tokenCache = {
    cacheKey,
    accessToken: result.access_token,
    expiresAt: now + expiresIn * 1000,
  };
  return result.access_token;
}

export function clearGoogleDriveTokenCache() {
  tokenCache = undefined;
}

function parseOptionalDate(value: unknown): Date | undefined {
  if (typeof value !== "string") return undefined;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? undefined : date;
}

function parseOptionalSize(value: unknown): number | undefined {
  if (typeof value !== "string") return undefined;
  const size = Number(value);
  return Number.isSafeInteger(size) && size >= 0 ? size : undefined;
}

export async function listGoogleDriveVideoFiles({
  credentials,
  folderId,
  filenameContains,
  fetch: fetchImplementation = fetch,
}: {
  credentials: GoogleDriveCredentials;
  folderId: string;
  filenameContains?: string | null;
  fetch?: typeof fetch;
}): Promise<GoogleDriveVideoFile[]> {
  const accessToken = await getGoogleDriveAccessToken(credentials, {
    fetch: fetchImplementation,
  });
  const files: GoogleDriveVideoFile[] = [];
  const seenFileIds = new Set<string>();
  const pendingFolderIds = [assertDriveFolderId(folderId)];
  const seenFolderIds = new Set(pendingFolderIds);
  let folderIndex = 0;
  const titleFilter = filenameContains?.trim().toLocaleLowerCase();

  while (folderIndex < pendingFolderIds.length) {
    const currentFolderId = pendingFolderIds[folderIndex++];

    let pageToken: string | undefined;
    do {
      const url = new URL(GOOGLE_DRIVE_FILES_ENDPOINT);
      url.searchParams.set(
        "q",
        `'${currentFolderId}' in parents and trashed = false`
      );
      url.searchParams.set(
        "fields",
        "nextPageToken,files(id,name,mimeType,size,createdTime,modifiedTime,capabilities(canDownload),shortcutDetails(targetId,targetMimeType))"
      );
      url.searchParams.set("pageSize", "1000");
      url.searchParams.set("orderBy", "createdTime");
      url.searchParams.set("supportsAllDrives", "true");
      url.searchParams.set("includeItemsFromAllDrives", "true");
      if (pageToken) url.searchParams.set("pageToken", pageToken);

      const response = await fetchImplementation(url, {
        headers: { authorization: `Bearer ${accessToken}` },
      });
      if (!response.ok) {
        throw await responseError(response, "Google Drive folder scan");
      }

      const result = (await response.json()) as {
        nextPageToken?: unknown;
        files?: Array<{
          id?: unknown;
          name?: unknown;
          mimeType?: unknown;
          size?: unknown;
          createdTime?: unknown;
          modifiedTime?: unknown;
          capabilities?: { canDownload?: unknown };
          shortcutDetails?: {
            targetId?: unknown;
            targetMimeType?: unknown;
          };
        }>;
      };

      for (const file of result.files ?? []) {
        if (
          typeof file.id !== "string" ||
          typeof file.name !== "string" ||
          typeof file.mimeType !== "string"
        ) {
          continue;
        }

        const isShortcut = file.mimeType === DRIVE_SHORTCUT_MIME_TYPE;
        const targetId = isShortcut
          ? file.shortcutDetails?.targetId
          : file.id;
        const targetMimeType = isShortcut
          ? file.shortcutDetails?.targetMimeType
          : file.mimeType;

        if (
          targetMimeType === DRIVE_FOLDER_MIME_TYPE &&
          typeof targetId === "string" &&
          DRIVE_FOLDER_ID_PATTERN.test(targetId) &&
          !seenFolderIds.has(targetId)
        ) {
          seenFolderIds.add(targetId);
          pendingFolderIds.push(targetId);
          continue;
        }

        if (
          typeof targetId !== "string" ||
          typeof targetMimeType !== "string" ||
          !targetMimeType.startsWith("video/") ||
          (!isShortcut && file.capabilities?.canDownload === false) ||
          seenFileIds.has(targetId) ||
          (titleFilter &&
            !file.name.toLocaleLowerCase().includes(titleFilter))
        ) {
          continue;
        }

        seenFileIds.add(targetId);
        files.push({
          id: targetId,
          name: file.name,
          mimeType: targetMimeType,
          sizeBytes: parseOptionalSize(file.size),
          createdAt: parseOptionalDate(file.createdTime),
          modifiedAt: parseOptionalDate(file.modifiedTime),
        });
      }

      pageToken =
        typeof result.nextPageToken === "string"
          ? result.nextPageToken
          : undefined;
    } while (pageToken);
  }

  return files;
}

export function titleFromGoogleDriveFileName(name: string): string {
  return name.replace(/\.[^.]+$/, "").trim() || "Untitled session";
}

export async function downloadGoogleDriveVideoToR2({
  env,
  credentials,
  fileId,
  recordingId,
  fetch: fetchImplementation = fetch,
}: {
  env: Pick<Env, "BUCKET">;
  credentials: GoogleDriveCredentials;
  fileId: string;
  recordingId: string;
  fetch?: typeof fetch;
}): Promise<{ r2VideoKey: string; fileSizeBytes?: number }> {
  const accessToken = await getGoogleDriveAccessToken(credentials, {
    fetch: fetchImplementation,
  });
  const url = new URL(
    `${GOOGLE_DRIVE_FILES_ENDPOINT}/${encodeURIComponent(fileId)}`
  );
  url.searchParams.set("alt", "media");
  url.searchParams.set("supportsAllDrives", "true");

  const response = await fetchImplementation(url, {
    headers: { authorization: `Bearer ${accessToken}` },
  });
  if (!response.ok || !response.body) {
    throw await responseError(response, "Google Drive video download");
  }

  const r2VideoKey = `recordings/${recordingId}/source.mp4`;
  await env.BUCKET.put(r2VideoKey, response.body, {
    httpMetadata: {
      contentType: response.headers.get("content-type") ?? "video/mp4",
    },
  });

  const contentLength = response.headers.get("content-length");
  const parsedSize = contentLength ? Number(contentLength) : undefined;
  return {
    r2VideoKey,
    fileSizeBytes:
      parsedSize !== undefined &&
      Number.isSafeInteger(parsedSize) &&
      parsedSize >= 0
        ? parsedSize
        : undefined,
  };
}

export async function testGoogleDriveConnection({
  credentials,
  folderIds,
  fetch: fetchImplementation = fetch,
}: {
  credentials: GoogleDriveCredentials;
  folderIds: string[];
  fetch?: typeof fetch;
}): Promise<Array<{ folderId: string; ok: boolean; errorCode?: string }>> {
  const accessToken = await getGoogleDriveAccessToken(credentials, {
    fetch: fetchImplementation,
    useCache: false,
  });

  if (folderIds.length === 0) {
    const aboutUrl = new URL("https://www.googleapis.com/drive/v3/about");
    aboutUrl.searchParams.set("fields", "user(emailAddress)");
    const response = await fetchImplementation(aboutUrl, {
      headers: { authorization: `Bearer ${accessToken}` },
    });
    if (!response.ok) {
      const err = await responseError(response, "Drive about");
      return [{ folderId: "", ok: false, errorCode: err.message }];
    }
    return [{ folderId: "", ok: true }];
  }

  const results: Array<{ folderId: string; ok: boolean; errorCode?: string }> = [];
  for (const folderId of folderIds) {
    const url = new URL(
      `${GOOGLE_DRIVE_FILES_ENDPOINT}/${encodeURIComponent(folderId)}`
    );
    url.searchParams.set("fields", "id,name");
    url.searchParams.set("supportsAllDrives", "true");

    const response = await fetchImplementation(url, {
      headers: { authorization: `Bearer ${accessToken}` },
    });
    if (response.ok) {
      results.push({ folderId, ok: true });
    } else {
      let code: string | undefined;
      try {
        const body = (await response.json()) as {
          error?: { errors?: Array<{ reason?: string }> };
        };
        code = body?.error?.errors?.[0]?.reason;
      } catch {
        // fall through
      }
      results.push({
        folderId,
        ok: false,
        errorCode: code ?? `HTTP ${response.status}`,
      });
    }
  }
  return results;
}
