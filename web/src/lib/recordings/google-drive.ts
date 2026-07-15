interface GoogleServiceAccountKey {
  client_email?: unknown;
  private_key?: unknown;
  private_key_id?: unknown;
}

export interface GoogleDriveCredentials {
  clientEmail: string;
  privateKey: string;
  privateKeyId?: string;
  impersonatedUser?: string;
}

export interface GoogleDriveVideoFile {
  id: string;
  name: string;
  mimeType: string;
  sizeBytes?: number;
  createdAt?: Date;
  modifiedAt?: Date;
}

type GoogleDriveEnvironment = Pick<
  Env,
  | "GOOGLE_DRIVE_SERVICE_ACCOUNT_JSON"
  | "GOOGLE_DRIVE_IMPERSONATED_USER"
>;

const DRIVE_READONLY_SCOPE =
  "https://www.googleapis.com/auth/drive.readonly";
const GOOGLE_TOKEN_ENDPOINT = "https://oauth2.googleapis.com/token";
const GOOGLE_DRIVE_FILES_ENDPOINT =
  "https://www.googleapis.com/drive/v3/files";
const DRIVE_FOLDER_ID_PATTERN = /^[A-Za-z0-9_-]{10,}$/;

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

export function getGoogleDriveCredentials(
  env: GoogleDriveEnvironment
): GoogleDriveCredentials {
  const rawKey = env.GOOGLE_DRIVE_SERVICE_ACCOUNT_JSON?.trim();
  if (!rawKey) {
    throw new Error(
      "Google Drive import is not configured. Add the service-account JSON secret."
    );
  }

  let parsed: GoogleServiceAccountKey;
  try {
    parsed = JSON.parse(rawKey) as GoogleServiceAccountKey;
  } catch {
    throw new Error(
      "The Google Drive service-account secret is not valid JSON."
    );
  }

  if (
    typeof parsed.client_email !== "string" ||
    typeof parsed.private_key !== "string"
  ) {
    throw new Error(
      "The Google Drive service-account secret is missing client_email or private_key."
    );
  }

  return {
    clientEmail: parsed.client_email,
    privateKey: parsed.private_key.replace(/\\n/g, "\n"),
    privateKeyId:
      typeof parsed.private_key_id === "string"
        ? parsed.private_key_id
        : undefined,
    impersonatedUser:
      env.GOOGLE_DRIVE_IMPERSONATED_USER?.trim() || undefined,
  };
}

export function getGoogleDriveConfiguration(
  env: GoogleDriveEnvironment
): { configured: boolean; clientEmail?: string; impersonatedUser?: string } {
  try {
    const credentials = getGoogleDriveCredentials(env);
    return {
      configured: true,
      clientEmail: credentials.clientEmail,
      impersonatedUser: credentials.impersonatedUser,
    };
  } catch {
    return { configured: false };
  }
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
  const detail = (await response.text()).replace(/\s+/g, " ").trim().slice(0, 500);
  return new Error(
    `${operation} failed with HTTP ${response.status}${detail ? `: ${detail}` : ""}`
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
  const cacheKey = `${credentials.clientEmail}:${credentials.impersonatedUser ?? ""}`;
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
    throw new Error("Google OAuth token response did not include an access token.");
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
  let pageToken: string | undefined;
  const titleFilter = filenameContains?.trim().toLocaleLowerCase();

  do {
    const url = new URL(GOOGLE_DRIVE_FILES_ENDPOINT);
    url.searchParams.set(
      "q",
      `'${assertDriveFolderId(folderId)}' in parents and trashed = false`
    );
    url.searchParams.set(
      "fields",
      "nextPageToken,files(id,name,mimeType,size,createdTime,modifiedTime,capabilities(canDownload))"
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
      }>;
    };

    for (const file of result.files ?? []) {
      if (
        typeof file.id !== "string" ||
        typeof file.name !== "string" ||
        typeof file.mimeType !== "string" ||
        !file.mimeType.startsWith("video/") ||
        file.capabilities?.canDownload === false ||
        (titleFilter &&
          !file.name.toLocaleLowerCase().includes(titleFilter))
      ) {
        continue;
      }

      files.push({
        id: file.id,
        name: file.name,
        mimeType: file.mimeType,
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
