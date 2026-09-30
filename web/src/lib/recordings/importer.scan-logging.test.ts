import { beforeEach, describe, expect, it, vi } from "vitest";
import type { GoogleDriveScanEvent } from "./google-drive";

const mocks = vi.hoisted(() => ({
  createCredentialCipher: vi.fn(),
  drizzle: vi.fn(),
  getGoogleDriveCredentials: vi.fn(),
  listGoogleDriveVideoFiles: vi.fn(),
}));

vi.mock("drizzle-orm/d1", () => ({
  drizzle: mocks.drizzle,
}));

vi.mock("@/lib/credentials/crypto", () => ({
  createCredentialCipher: mocks.createCredentialCipher,
}));

vi.mock("@/lib/credentials/google-drive", () => ({
  getGoogleDriveCredentials: mocks.getGoogleDriveCredentials,
}));

vi.mock("@/lib/recordings/google-drive", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("@/lib/recordings/google-drive")>();
  return {
    ...actual,
    listGoogleDriveVideoFiles: mocks.listGoogleDriveVideoFiles,
  };
});

import {
  previewRecordingImportSource,
  syncEnabledRecordingImportSources,
} from "./importer";

const source = {
  id: "source-1",
  name: "Drive source",
  programId: "program-1",
  driveFolderId: "folder-1",
  filenameContains: null,
  enabled: true,
  lastSyncedAt: null,
  lastError: null,
  createdAt: new Date("2026-08-01T00:00:00Z"),
  updatedAt: new Date("2026-08-01T00:00:00Z"),
};

function createMockDb({
  enabledSources = [],
}: {
  enabledSources?: typeof source[];
} = {}) {
  const updateWhere = vi.fn().mockResolvedValue(undefined);
  const updateSet = vi.fn((_value: Record<string, unknown>) => ({
    where: updateWhere,
  }));
  const selectWhere = vi.fn().mockResolvedValue([]);
  const selectFrom = vi.fn(() => ({ where: selectWhere }));

  return {
    db: {
      query: {
        recordingImportSource: {
          findFirst: vi.fn().mockResolvedValue(source),
          findMany: vi.fn().mockResolvedValue(enabledSources),
        },
      },
      select: vi.fn(() => ({ from: selectFrom })),
      update: vi.fn(() => ({ set: updateSet })),
    },
    updateSet,
  };
}

function createEnv(overrides: Partial<Env> = {}) {
  return {
    CREDENTIALS_ENCRYPTION_KEY: "configured",
    DB: {},
    RECORDING_QUEUE: { sendBatch: vi.fn().mockResolvedValue(undefined) },
    ...overrides,
  } as unknown as Env;
}

function parseLogs(log: { mock: { calls: unknown[][] } }) {
  return log.mock.calls.map(([entry]) => JSON.parse(String(entry)));
}

describe("recording import scan logging", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    vi.clearAllMocks();
    mocks.createCredentialCipher.mockReturnValue({});
    mocks.getGoogleDriveCredentials.mockResolvedValue({
      clientEmail: "drive@example.com",
      privateKey: "unused",
    });
    mocks.listGoogleDriveVideoFiles.mockResolvedValue([]);
  });

  it("writes source-scoped scan counts without Drive identifiers", async () => {
    const state = createMockDb();
    mocks.drizzle.mockReturnValue(state.db);
    mocks.listGoogleDriveVideoFiles.mockImplementation(
      async ({
        onScanEvent,
      }: {
        onScanEvent?: (event: GoogleDriveScanEvent) => void;
      }) => {
        onScanEvent?.({ type: "start", filenameFilterConfigured: false });
        onScanEvent?.({
          type: "page",
          folderNumber: 1,
          pageNumber: 1,
          filesReturned: 10,
          videosDiscovered: 2,
          nestedFoldersQueued: 1,
          folderShortcutsQueued: 0,
          videoShortcutsDiscovered: 0,
          duplicateVideosSkipped: 0,
          nonVideosSkipped: 7,
          filenameFilteredSkipped: 0,
          downloadBlockedSkipped: 0,
          invalidItemsSkipped: 0,
          hasNextPage: true,
        });
        onScanEvent?.({
          type: "complete",
          foldersScanned: 2,
          pagesScanned: 1,
          videosDiscovered: 2,
        });
        return [
          { id: "file-1", name: "Session one.mp4", mimeType: "video/mp4" },
          { id: "file-2", name: "Session two.mp4", mimeType: "video/mp4" },
        ];
      }
    );
    const log = vi.spyOn(console, "log").mockImplementation(() => undefined);

    await expect(
      previewRecordingImportSource(createEnv(), source.id)
    ).resolves.toEqual({
      discovered: 2,
      importable: 2,
      new: 2,
      pending: 0,
      skipped: 0,
      driveItemsScanned: 10,
      visibleVideos: 2,
      downloadBlockedVideos: 0,
      nonVideoItemsSkipped: 7,
    });

    expect(mocks.listGoogleDriveVideoFiles).toHaveBeenCalledWith(
      expect.objectContaining({
        folderId: source.driveFolderId,
        filenameContains: source.filenameContains,
        onScanEvent: expect.any(Function),
      })
    );
    expect(parseLogs(log)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          event: "drive_import_source_scan_start",
          component: "recording_import",
          sourceId: source.id,
          operation: "preview",
          filenameFilterConfigured: false,
        }),
        expect.objectContaining({
          event: "drive_scan_page",
          component: "recording_import",
          sourceId: source.id,
          operation: "preview",
          filesReturned: 10,
          videosDiscovered: 2,
          nonVideosSkipped: 7,
          hasNextPage: true,
        }),
        expect.objectContaining({
          event: "drive_scan_complete",
          component: "recording_import",
          sourceId: source.id,
          operation: "preview",
          foldersScanned: 2,
          pagesScanned: 1,
          videosDiscovered: 2,
        }),
        expect.objectContaining({
          event: "drive_import_source_scan_done",
          component: "recording_import",
          sourceId: source.id,
          operation: "preview",
          discovered: 2,
          importable: 2,
          driveItemsScanned: 10,
          visibleVideos: 2,
          downloadBlockedVideos: 0,
        }),
      ])
    );
    expect(parseLogs(log)).toSatisfy((entries: Array<Record<string, unknown>>) =>
      entries.every(
        (entry) =>
          !("folderId" in entry) &&
          !("driveFolderId" in entry) &&
          !("driveFileId" in entry) &&
          !("pageToken" in entry)
      )
    );
  });

  it("accumulates download-blocked and visible video counts across pages", async () => {
    const state = createMockDb();
    mocks.drizzle.mockReturnValue(state.db);
    mocks.listGoogleDriveVideoFiles.mockImplementation(
      async ({
        onScanEvent,
      }: {
        onScanEvent?: (event: GoogleDriveScanEvent) => void;
      }) => {
        onScanEvent?.({ type: "start", filenameFilterConfigured: false });
        // Mirrors the production scan that motivated these counters: most video
        // files came back flagged by Drive as not downloadable.
        onScanEvent?.({
          type: "page",
          folderNumber: 1,
          pageNumber: 1,
          filesReturned: 50,
          videosDiscovered: 6,
          nestedFoldersQueued: 0,
          folderShortcutsQueued: 0,
          videoShortcutsDiscovered: 0,
          duplicateVideosSkipped: 1,
          nonVideosSkipped: 2,
          filenameFilteredSkipped: 3,
          downloadBlockedSkipped: 38,
          invalidItemsSkipped: 0,
          hasNextPage: true,
        });
        onScanEvent?.({
          type: "page",
          folderNumber: 1,
          pageNumber: 2,
          filesReturned: 41,
          videosDiscovered: 4,
          nestedFoldersQueued: 0,
          folderShortcutsQueued: 0,
          videoShortcutsDiscovered: 0,
          duplicateVideosSkipped: 0,
          nonVideosSkipped: 2,
          filenameFilteredSkipped: 0,
          downloadBlockedSkipped: 35,
          invalidItemsSkipped: 0,
          hasNextPage: false,
        });
        onScanEvent?.({
          type: "complete",
          foldersScanned: 1,
          pagesScanned: 2,
          videosDiscovered: 10,
        });
        return Array.from({ length: 10 }, (_, index) => ({
          id: `file-${index}`,
          name: `Session ${index}.mp4`,
          mimeType: "video/mp4",
        }));
      }
    );

    await expect(
      previewRecordingImportSource(createEnv(), source.id)
    ).resolves.toEqual({
      discovered: 10,
      importable: 10,
      new: 10,
      pending: 0,
      skipped: 0,
      // 50 + 41 items returned across the two pages.
      driveItemsScanned: 91,
      // Videos Drive showed us: (6 + 38 + 1 + 3) + (4 + 35 + 0 + 0).
      visibleVideos: 87,
      // 38 on page one plus 35 on page two — only 10 were actually importable.
      downloadBlockedVideos: 73,
      nonVideoItemsSkipped: 4,
    });
  });
  it("logs and persists scan failures for source diagnostics", async () => {
    const state = createMockDb();
    mocks.drizzle.mockReturnValue(state.db);
    mocks.listGoogleDriveVideoFiles.mockRejectedValue(
      new Error("Google Drive folder scan failed with HTTP 403: notFound")
    );
    const log = vi.spyOn(console, "log").mockImplementation(() => undefined);

    await expect(
      previewRecordingImportSource(createEnv(), source.id)
    ).rejects.toThrow("Google Drive folder scan failed with HTTP 403: notFound");

    expect(state.updateSet).toHaveBeenCalledWith({
      lastError: "Google Drive folder scan failed with HTTP 403: notFound",
    });
    expect(parseLogs(log)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          event: "drive_import_source_scan_failed",
          component: "recording_import",
          sourceId: source.id,
          operation: "preview",
          message: "Google Drive folder scan failed with HTTP 403: notFound",
        }),
      ])
    );
  });

  it("logs when scheduled sync has no enabled sources", async () => {
    const state = createMockDb();
    mocks.drizzle.mockReturnValue(state.db);
    const log = vi.spyOn(console, "log").mockImplementation(() => undefined);

    await expect(
      syncEnabledRecordingImportSources(createEnv())
    ).resolves.toEqual([]);

    expect(mocks.getGoogleDriveCredentials).not.toHaveBeenCalled();

    expect(parseLogs(log)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          event: "drive_sync_skipped",
          component: "recording_import",
          reason: "no_enabled_sources",
        }),
      ])
    );
  });

  it("updates lastSyncedAt after a successful scheduled source scan", async () => {
    const state = createMockDb({ enabledSources: [source] });
    mocks.drizzle.mockReturnValue(state.db);
    const startedAt = Date.now();

    await expect(
      syncEnabledRecordingImportSources(createEnv())
    ).resolves.toEqual([
      { discovered: 0, created: 0, queued: 0, skipped: 0 },
    ]);

    const successUpdate = state.updateSet.mock.calls.find(
      ([value]) => value.lastError === null
    )?.[0];
    expect(successUpdate?.lastSyncedAt).toBeInstanceOf(Date);
    const lastSyncedAt = successUpdate?.lastSyncedAt;
    if (!(lastSyncedAt instanceof Date)) {
      throw new TypeError("Expected the successful sync to persist a Date.");
    }
    expect(lastSyncedAt.getTime()).toBeGreaterThanOrEqual(startedAt);
  });

  it("marks enabled sources failed when credential encryption is absent", async () => {
    const state = createMockDb({ enabledSources: [source] });
    mocks.drizzle.mockReturnValue(state.db);

    await expect(
      syncEnabledRecordingImportSources(
        createEnv({ CREDENTIALS_ENCRYPTION_KEY: undefined })
      )
    ).rejects.toThrow(
      "Google Drive import failed for 1 of 1 enabled sources."
    );

    expect(state.updateSet).toHaveBeenCalledWith({
      lastError:
        "Google Drive import cannot load credentials because credential encryption is not configured.",
    });
    expect(mocks.getGoogleDriveCredentials).not.toHaveBeenCalled();
  });

  it("redacts and bounds credential-loading failures on every enabled source", async () => {
    const secondSource = { ...source, id: "source-2", name: "Second source" };
    const state = createMockDb({ enabledSources: [source, secondSource] });
    state.db.query.recordingImportSource.findFirst
      .mockResolvedValueOnce(source)
      .mockResolvedValueOnce(secondSource);
    mocks.drizzle.mockReturnValue(state.db);
    const privateValue = "credential-value-that-must-not-leak";
    mocks.getGoogleDriveCredentials.mockRejectedValue(
      new Error(`token=${privateValue} ${"x".repeat(600)}`)
    );
    const log = vi.spyOn(console, "log").mockImplementation(() => undefined);

    await expect(
      syncEnabledRecordingImportSources(createEnv())
    ).rejects.toThrow(
      "Google Drive import failed for 2 of 2 enabled sources."
    );

    const failures = state.updateSet.mock.calls
      .map(([value]) => value.lastError)
      .filter((value): value is string => typeof value === "string");
    expect(failures).toHaveLength(2);
    expect(failures.every((message) => message.length <= 500)).toBe(true);
    expect(JSON.stringify(failures)).toContain("token=[REDACTED]");
    expect(JSON.stringify(failures)).not.toContain(privateValue);
    expect(JSON.stringify(parseLogs(log))).not.toContain(privateValue);
  });

  it("marks enabled sources failed when Google Drive credentials are missing", async () => {
    const state = createMockDb({ enabledSources: [source] });
    mocks.drizzle.mockReturnValue(state.db);
    mocks.getGoogleDriveCredentials.mockResolvedValue(null);

    await expect(
      syncEnabledRecordingImportSources(createEnv())
    ).rejects.toThrow(
      "Google Drive import failed for 1 of 1 enabled sources."
    );

    expect(state.updateSet).toHaveBeenCalledWith({
      lastError:
        "Google Drive credentials are not configured. Set them in Admin → Integrations.",
    });
  });

  it("makes scheduled scan failures visible without leaking their details", async () => {
    const state = createMockDb({ enabledSources: [source] });
    mocks.drizzle.mockReturnValue(state.db);
    const privateValue = "scan-secret-that-must-not-leak";
    mocks.listGoogleDriveVideoFiles.mockRejectedValue(
      new Error(`API key=${privateValue} rejected`)
    );
    const log = vi.spyOn(console, "log").mockImplementation(() => undefined);

    await expect(
      syncEnabledRecordingImportSources(createEnv())
    ).rejects.toThrow(
      "Google Drive import failed for 1 of 1 enabled sources."
    );

    expect(state.updateSet).toHaveBeenCalledWith({
      lastError: "API key=[REDACTED] rejected",
    });
    expect(JSON.stringify(parseLogs(log))).not.toContain(privateValue);
  });
});
