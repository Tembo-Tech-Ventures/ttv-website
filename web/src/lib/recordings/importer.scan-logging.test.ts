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

function createMockDb() {
  const updateWhere = vi.fn().mockResolvedValue(undefined);
  const updateSet = vi.fn(() => ({ where: updateWhere }));
  const selectWhere = vi.fn().mockResolvedValue([]);
  const selectFrom = vi.fn(() => ({ where: selectWhere }));

  return {
    db: {
      query: {
        recordingImportSource: {
          findFirst: vi.fn().mockResolvedValue(source),
          findMany: vi.fn().mockResolvedValue([]),
        },
      },
      select: vi.fn(() => ({ from: selectFrom })),
      update: vi.fn(() => ({ set: updateSet })),
    },
    updateSet,
  };
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
      previewRecordingImportSource({ DB: {} } as Env, source.id)
    ).resolves.toEqual({
      discovered: 2,
      importable: 2,
      new: 2,
      pending: 0,
      skipped: 0,
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

  it("logs and persists scan failures for source diagnostics", async () => {
    const state = createMockDb();
    mocks.drizzle.mockReturnValue(state.db);
    mocks.listGoogleDriveVideoFiles.mockRejectedValue(
      new Error("Google Drive folder scan failed with HTTP 403: notFound")
    );
    const log = vi.spyOn(console, "log").mockImplementation(() => undefined);

    await expect(
      previewRecordingImportSource({ DB: {} } as Env, source.id)
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
      syncEnabledRecordingImportSources({
        CREDENTIALS_ENCRYPTION_KEY: "configured",
        DB: {},
      } as Env)
    ).resolves.toEqual([]);

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
});
