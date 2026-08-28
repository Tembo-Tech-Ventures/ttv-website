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
  listGoogleDriveVideoFiles,
  parseGoogleDriveFolderId,
  testGoogleDriveConnection,
  titleFromGoogleDriveFileName,
  type GoogleDriveCredentials,
  type GoogleDriveScanEvent,
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

describe("Google Drive folder parsing", () => {
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
    const scanEvents: GoogleDriveScanEvent[] = [];

    const files = await listGoogleDriveVideoFiles({
      credentials,
      folderId: "1AbCdEfGhIjKlMnOpQrStUvWxYz",
      filenameContains: "cohort 2026",
      onScanEvent: (event) => scanEvents.push(event),
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
    expect(listUrl.searchParams.get("pageSize")).toBe("1000");
    expect(listUrl.searchParams.get("supportsAllDrives")).toBe("true");
    expect(scanEvents).toEqual([
      { type: "start", filenameFilterConfigured: true },
      expect.objectContaining({
        type: "page",
        folderNumber: 1,
        pageNumber: 1,
        filesReturned: 3,
        videosDiscovered: 1,
        nonVideosSkipped: 1,
        downloadBlockedSkipped: 1,
        hasNextPage: true,
      }),
      expect.objectContaining({
        type: "page",
        folderNumber: 1,
        pageNumber: 2,
        filesReturned: 2,
        videosDiscovered: 1,
        filenameFilteredSkipped: 1,
        hasNextPage: false,
      }),
      {
        type: "complete",
        foldersScanned: 1,
        pagesScanned: 2,
        videosDiscovered: 2,
      },
    ]);
  });

  it("fails fast when Google repeats a folder page token", async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = new URL(String(input));
      if (url.hostname === "oauth2.googleapis.com") {
        return Response.json({ access_token: "token", expires_in: 3600 });
      }
      return Response.json({ nextPageToken: "same-token", files: [] });
    });

    await expect(
      listGoogleDriveVideoFiles({
        credentials,
        folderId: "1AbCdEfGhIjKlMnOpQrStUvWxYz",
        fetch: fetchMock as unknown as typeof fetch,
      })
    ).rejects.toThrow(
      "Google Drive returned a repeated page token while scanning a folder"
    );
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it("does not impose an application-side ten-video scan limit", async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = new URL(String(input));
      if (url.hostname === "oauth2.googleapis.com") {
        return Response.json({ access_token: "token", expires_in: 3600 });
      }
      return Response.json({
        files: Array.from({ length: 125 }, (_, index) => ({
          id: `video-${String(index + 1).padStart(3, "0")}`,
          name: `Session ${index + 1}.mp4`,
          mimeType: "video/mp4",
        })),
      });
    });

    await expect(
      listGoogleDriveVideoFiles({
        credentials,
        folderId: "1AbCdEfGhIjKlMnOpQrStUvWxYz",
        fetch: fetchMock as unknown as typeof fetch,
      })
    ).resolves.toHaveLength(125);
  });

  it("traverses nested folders and resolves folder and video shortcuts once", async () => {
    const rootFolderId = "root-folder-1234567890";
    const nestedFolderId = "nested-folder-12345678";
    const shortcutFolderId = "shortcut-folder-123456";
    const shortcutVideoId = "shortcut-video-1234567";
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = new URL(String(input));
      if (url.hostname === "oauth2.googleapis.com") {
        return Response.json({ access_token: "token", expires_in: 3600 });
      }

      const query = url.searchParams.get("q");
      if (query?.includes(`'${rootFolderId}'`)) {
        return Response.json({
          files: [
            {
              id: nestedFolderId,
              name: "Archive",
              mimeType: "application/vnd.google-apps.folder",
            },
            {
              id: "folder-shortcut-12345",
              name: "Older archive",
              mimeType: "application/vnd.google-apps.shortcut",
              shortcutDetails: {
                targetId: shortcutFolderId,
                targetMimeType: "application/vnd.google-apps.folder",
              },
            },
            {
              id: "video-shortcut-12345",
              name: "Cohort shortcut.mp4",
              mimeType: "application/vnd.google-apps.shortcut",
              capabilities: { canDownload: false },
              shortcutDetails: {
                targetId: shortcutVideoId,
                targetMimeType: "video/mp4",
              },
            },
          ],
        });
      }
      if (query?.includes(`'${nestedFolderId}'`)) {
        return Response.json({
          files: [
            {
              id: shortcutVideoId,
              name: "Cohort duplicate target.mp4",
              mimeType: "video/mp4",
            },
            {
              id: "nested-video-12345678",
              name: "Cohort nested session.webm",
              mimeType: "video/webm",
            },
          ],
        });
      }
      if (query?.includes(`'${shortcutFolderId}'`)) {
        return Response.json({
          files: [
            {
              id: "cycle-shortcut-12345",
              name: "Back to root",
              mimeType: "application/vnd.google-apps.shortcut",
              shortcutDetails: {
                targetId: rootFolderId,
                targetMimeType: "application/vnd.google-apps.folder",
              },
            },
            {
              id: "archived-video-123456",
              name: "Cohort archived session.mp4",
              mimeType: "video/mp4",
            },
            {
              id: "filtered-video-123456",
              name: "Another programme.mp4",
              mimeType: "video/mp4",
            },
          ],
        });
      }
      return new Response("Unexpected folder", { status: 500 });
    });

    const files = await listGoogleDriveVideoFiles({
      credentials,
      folderId: rootFolderId,
      filenameContains: "cohort",
      fetch: fetchMock as unknown as typeof fetch,
    });

    expect(files.map(({ id }) => id)).toEqual([
      shortcutVideoId,
      "nested-video-12345678",
      "archived-video-123456",
    ]);
    expect(fetchMock).toHaveBeenCalledTimes(4);
    const rootScanUrl = new URL(String(fetchMock.mock.calls[1][0]));
    expect(rootScanUrl.searchParams.get("fields")).toContain(
      "shortcutDetails(targetId,targetMimeType)"
    );
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

describe("Google Drive connection test", () => {
  it("probes each source folder and reports sanitized results", async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = new URL(String(input));
      if (url.hostname === "oauth2.googleapis.com") {
        return Response.json({ access_token: "token", expires_in: 3600 });
      }
      if (url.pathname.includes("folder-ok")) {
        return Response.json({ id: "folder-ok", name: "Sessions" });
      }
      return Response.json(
        { error: { errors: [{ reason: "notFound" }] } },
        { status: 404 }
      );
    });
    const fetchImplementation = fetchMock as unknown as typeof fetch;

    const results = await testGoogleDriveConnection({
      credentials,
      folderIds: ["folder-ok", "folder-missing"],
      fetch: fetchImplementation,
    });

    expect(results).toEqual([
      { folderId: "folder-ok", ok: true },
      { folderId: "folder-missing", ok: false, errorCode: "notFound" },
    ]);
  });

  it("falls back to Drive about when no folders are configured", async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = new URL(String(input));
      if (url.hostname === "oauth2.googleapis.com") {
        return Response.json({ access_token: "token", expires_in: 3600 });
      }
      return Response.json({ user: { emailAddress: "test@example.com" } });
    });
    const fetchImplementation = fetchMock as unknown as typeof fetch;

    const results = await testGoogleDriveConnection({
      credentials,
      folderIds: [],
      fetch: fetchImplementation,
    });

    expect(results).toEqual([{ folderId: "", ok: true }]);
  });

  it("includes privateKeyId in the cache key so replacing credentials invalidates tokens", async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = new URL(String(input));
      if (url.hostname === "oauth2.googleapis.com") {
        return Response.json({ access_token: "token-v1", expires_in: 3600 });
      }
      return Response.json({ user: { emailAddress: "test@example.com" } });
    });
    const fetchImplementation = fetchMock as unknown as typeof fetch;

    await testGoogleDriveConnection({
      credentials: { ...credentials, privateKeyId: "key-1" },
      folderIds: [],
      fetch: fetchImplementation,
    });

    const tokenCalls = fetchMock.mock.calls.filter(([input]) =>
      String(input).includes("oauth2.googleapis.com")
    );
    expect(tokenCalls).toHaveLength(1);
  });

  it("includes impersonatedUser in the cache key so changing delegation invalidates tokens", async () => {
    let tokenCallCount = 0;
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = new URL(String(input));
      if (url.hostname === "oauth2.googleapis.com") {
        tokenCallCount++;
        return Response.json({ access_token: `token-${tokenCallCount}`, expires_in: 3600 });
      }
      return Response.json({ user: { emailAddress: "test@example.com" } });
    });
    const fetchImplementation = fetchMock as unknown as typeof fetch;

    await listGoogleDriveVideoFiles({
      credentials: { ...credentials, impersonatedUser: "user-a@example.com" },
      folderId: "1AbCdEfGhIjKlMnOpQrStUvWxYz",
      fetch: fetchImplementation,
    });
    expect(tokenCallCount).toBe(1);

    await listGoogleDriveVideoFiles({
      credentials: { ...credentials, impersonatedUser: "user-b@example.com" },
      folderId: "1AbCdEfGhIjKlMnOpQrStUvWxYz",
      fetch: fetchImplementation,
    });
    expect(tokenCallCount).toBe(2);
  });
});
