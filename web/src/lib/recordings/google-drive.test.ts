import {
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import {
  clearGoogleDriveTokenCache,
  createGoogleServiceAccountAssertion,
  downloadGoogleDriveVideoToR2,
  getGoogleDriveConfiguration,
  getGoogleDriveCredentials,
  listGoogleDriveVideoFiles,
  parseGoogleDriveFolderId,
  titleFromGoogleDriveFileName,
  type GoogleDriveCredentials,
} from "./google-drive";

let credentials: GoogleDriveCredentials;
let publicKey: CryptoKey;

function arrayBufferToPem(buffer: ArrayBuffer): string {
  const base64 = Buffer.from(buffer).toString("base64");
  const lines = base64.match(/.{1,64}/g)?.join("\n") ?? base64;
  return `-----BEGIN PRIVATE KEY-----\n${lines}\n-----END PRIVATE KEY-----`;
}

beforeAll(async () => {
  const keyPair = await crypto.subtle.generateKey(
    {
      name: "RSASSA-PKCS1-v1_5",
      modulusLength: 2048,
      publicExponent: new Uint8Array([1, 0, 1]),
      hash: "SHA-256",
    },
    true,
    ["sign", "verify"]
  );
  credentials = {
    clientEmail: "recording-import@example.iam.gserviceaccount.com",
    privateKey: arrayBufferToPem(
      await crypto.subtle.exportKey("pkcs8", keyPair.privateKey)
    ),
    privateKeyId: "test-key",
  };
  publicKey = keyPair.publicKey;
});

beforeEach(() => {
  clearGoogleDriveTokenCache();
});

describe("Google Drive configuration", () => {
  it("accepts raw folder IDs and common Drive folder URLs", () => {
    const id = "1AbCdEfGhIjKlMnOpQrStUvWxYz";
    expect(parseGoogleDriveFolderId(id)).toBe(id);
    expect(
      parseGoogleDriveFolderId(
        `https://drive.google.com/drive/u/0/folders/${id}?usp=sharing`
      )
    ).toBe(id);
    expect(
      parseGoogleDriveFolderId(
        `https://drive.google.com/open?id=${id}`
      )
    ).toBe(id);
  });

  it("rejects missing or malformed folder identifiers", () => {
    expect(() => parseGoogleDriveFolderId("")).toThrow(
      "Google Drive folder is required"
    );
    expect(() => parseGoogleDriveFolderId("not a folder")).toThrow(
      "valid Google Drive folder"
    );
  });

  it("parses service-account JSON without exposing the private key", () => {
    const env = {
      GOOGLE_DRIVE_SERVICE_ACCOUNT_JSON: JSON.stringify({
        client_email: "drive@example.iam.gserviceaccount.com",
        private_key: "-----BEGIN PRIVATE KEY-----\\nabc\\n-----END PRIVATE KEY-----\\n",
      }),
      GOOGLE_DRIVE_IMPERSONATED_USER: "owner@example.org",
    } as Env;

    expect(getGoogleDriveCredentials(env)).toMatchObject({
      clientEmail: "drive@example.iam.gserviceaccount.com",
      impersonatedUser: "owner@example.org",
    });
    expect(getGoogleDriveCredentials(env).privateKey).toContain("\nabc\n");
    expect(getGoogleDriveConfiguration(env)).toEqual({
      configured: true,
      clientEmail: "drive@example.iam.gserviceaccount.com",
      impersonatedUser: "owner@example.org",
    });
    expect(getGoogleDriveConfiguration({} as Env)).toEqual({
      configured: false,
    });
  });
});

describe("Google service-account authentication", () => {
  it("creates a verifiable, one-hour read-only Drive assertion", async () => {
    const now = Date.UTC(2026, 6, 15, 12, 0, 0);
    const assertion = await createGoogleServiceAccountAssertion(
      {
        ...credentials,
        impersonatedUser: "owner@example.org",
      },
      now
    );
    const [encodedHeader, encodedClaims, encodedSignature] =
      assertion.split(".");
    const claims = JSON.parse(
      Buffer.from(encodedClaims, "base64url").toString("utf8")
    ) as Record<string, unknown>;

    expect(
      JSON.parse(Buffer.from(encodedHeader, "base64url").toString("utf8"))
    ).toMatchObject({ alg: "RS256", kid: "test-key" });
    expect(claims).toMatchObject({
      iss: credentials.clientEmail,
      sub: "owner@example.org",
      scope: "https://www.googleapis.com/auth/drive.readonly",
      aud: "https://oauth2.googleapis.com/token",
      iat: Math.floor(now / 1000),
      exp: Math.floor(now / 1000) + 3600,
    });
    await expect(
      crypto.subtle.verify(
        "RSASSA-PKCS1-v1_5",
        publicKey,
        Buffer.from(encodedSignature, "base64url"),
        new TextEncoder().encode(`${encodedHeader}.${encodedClaims}`)
      )
    ).resolves.toBe(true);
  });
});

describe("Google Drive file operations", () => {
  it("paginates folder scans and keeps only matching downloadable videos", async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = new URL(String(input));
      if (url.hostname === "oauth2.googleapis.com") {
        return Response.json({ access_token: "token", expires_in: 3600 });
      }
      if (!url.searchParams.has("pageToken")) {
        return Response.json({
          nextPageToken: "next",
          files: [
            {
              id: "video-1",
              name: "Cohort 2026 Session 1.mp4",
              mimeType: "video/mp4",
              size: "1234",
              createdTime: "2026-07-14T10:00:00Z",
              capabilities: { canDownload: true },
            },
            {
              id: "document-1",
              name: "Cohort 2026 notes",
              mimeType: "application/vnd.google-apps.document",
            },
            {
              id: "blocked-video",
              name: "Cohort 2026 private.mp4",
              mimeType: "video/mp4",
              capabilities: { canDownload: false },
            },
          ],
        });
      }
      return Response.json({
        files: [
          {
            id: "video-2",
            name: "COHORT 2026 Session 2.webm",
            mimeType: "video/webm",
            modifiedTime: "2026-07-15T10:00:00Z",
          },
          {
            id: "other-video",
            name: "Another program.mp4",
            mimeType: "video/mp4",
          },
        ],
      });
    });
    const fetchImplementation = fetchMock as unknown as typeof fetch;

    const files = await listGoogleDriveVideoFiles({
      credentials,
      folderId: "1AbCdEfGhIjKlMnOpQrStUvWxYz",
      filenameContains: "cohort 2026",
      fetch: fetchImplementation,
    });

    expect(files.map(({ id }) => id)).toEqual(["video-1", "video-2"]);
    expect(files[0]).toMatchObject({
      sizeBytes: 1234,
      createdAt: new Date("2026-07-14T10:00:00Z"),
    });
    expect(fetchMock).toHaveBeenCalledTimes(3);
    const listUrl = new URL(String(fetchMock.mock.calls[1][0]));
    expect(listUrl.searchParams.get("q")).toContain("in parents");
    expect(listUrl.searchParams.get("supportsAllDrives")).toBe("true");
  });

  it("streams a Drive download into the recording's R2 key", async () => {
    const put = vi.fn().mockResolvedValue(undefined);
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = new URL(String(input));
      if (url.hostname === "oauth2.googleapis.com") {
        return Response.json({ access_token: "token", expires_in: 3600 });
      }
      return new Response("video bytes", {
        headers: {
          "content-type": "video/mp4",
          "content-length": "11",
        },
      });
    });
    const fetchImplementation = fetchMock as unknown as typeof fetch;

    await expect(
      downloadGoogleDriveVideoToR2({
        env: { BUCKET: { put } as unknown as R2Bucket },
        credentials,
        fileId: "drive-file-123",
        recordingId: "recording123",
        fetch: fetchImplementation,
      })
    ).resolves.toEqual({
      r2VideoKey: "recordings/recording123/source.mp4",
      fileSizeBytes: 11,
    });

    expect(put).toHaveBeenCalledWith(
      "recordings/recording123/source.mp4",
      expect.any(ReadableStream),
      { httpMetadata: { contentType: "video/mp4" } }
    );
    const downloadUrl = new URL(String(fetchMock.mock.calls[1][0]));
    expect(downloadUrl.searchParams.get("alt")).toBe("media");
  });

  it("derives an editable title from the Drive filename", () => {
    expect(titleFromGoogleDriveFileName("Mentor Hours 2026-07-15.mp4")).toBe(
      "Mentor Hours 2026-07-15"
    );
    expect(titleFromGoogleDriveFileName(".mp4")).toBe("Untitled session");
  });
});
