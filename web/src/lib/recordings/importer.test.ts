import { describe, expect, it, vi } from "vitest";
import {
  queueGoogleDriveFiles,
  type KnownDriveRecording,
  type RecordingImportStore,
} from "./importer";
import type { GoogleDriveVideoFile } from "./google-drive";

function createStore(
  known: KnownDriveRecording[] = [],
  conflictFileIds = new Set<string>()
) {
  const rows = [...known];
  const created: Array<{
    id: string;
    programId: string;
    driveFileId: string;
    title: string;
    recordedAt?: Date;
    fileSizeBytes?: number;
  }> = [];
  const claimed: string[][] = [];
  const released: string[][] = [];

  const store: RecordingImportStore = {
    async listKnownDriveRecordings() {
      return [...rows];
    },
    async createPendingRecording(input) {
      created.push(input);
      if (conflictFileIds.has(input.driveFileId)) return null;
      const row: KnownDriveRecording = {
        id: input.id,
        driveFileId: input.driveFileId,
        processingStatus: "pending",
      };
      rows.push(row);
      return row;
    },
    async claimPendingRecordings(ids) {
      const claimedIds = rows
        .filter(
          (row) =>
            ids.includes(row.id) && row.processingStatus === "pending"
        )
        .map(({ id }) => id);
      claimed.push(claimedIds);
      for (const row of rows) {
        if (claimedIds.includes(row.id)) row.processingStatus = "queued";
      }
      return claimedIds;
    },
    async releasePendingRecordings(ids) {
      released.push([...ids]);
      for (const row of rows) {
        if (ids.includes(row.id) && row.processingStatus === "queued") {
          row.processingStatus = "pending";
        }
      }
    },
  };

  return { store, rows, created, claimed, released };
}

function video(
  id: string,
  overrides: Partial<GoogleDriveVideoFile> = {}
): GoogleDriveVideoFile {
  return {
    id,
    name: `Session ${id}.mp4`,
    mimeType: "video/mp4",
    ...overrides,
  };
}

describe("Google Drive recording queueing", () => {
  it("creates new recordings, retries pending rows, and skips known work", async () => {
    const state = createStore([
      {
        id: "pending-recording",
        driveFileId: "pending-file",
        processingStatus: "pending",
      },
      {
        id: "complete-recording",
        driveFileId: "complete-file",
        processingStatus: "complete",
      },
    ]);
    const sendBatch = vi.fn().mockResolvedValue(undefined);
    const recordedAt = new Date("2026-07-15T10:00:00Z");

    const summary = await queueGoogleDriveFiles({
      files: [
        video("new-file", {
          name: "Cohort Session.mp4",
          sizeBytes: 500,
          createdAt: recordedAt,
        }),
        video("pending-file"),
        video("complete-file"),
      ],
      source: { programId: "program-1" },
      store: state.store,
      queue: { sendBatch },
    });

    expect(summary).toEqual({
      discovered: 3,
      created: 1,
      queued: 2,
      skipped: 1,
    });
    expect(state.created).toHaveLength(1);
    expect(state.created[0]).toMatchObject({
      programId: "program-1",
      driveFileId: "new-file",
      title: "Cohort Session",
      recordedAt,
      fileSizeBytes: 500,
    });
    expect(sendBatch).toHaveBeenCalledOnce();
    const messages = sendBatch.mock.calls[0][0] as Array<{
      body: { type: string; recordingId: string };
    }>;
    expect(messages).toEqual(
      expect.arrayContaining([
        {
          body: {
            type: "process_recording",
            recordingId: "pending-recording",
          },
        },
        {
          body: {
            type: "process_recording",
            recordingId: state.created[0].id,
          },
        },
      ])
    );
    expect(state.claimed).toEqual([
      expect.arrayContaining(["pending-recording", state.created[0].id]),
    ]);
    expect(state.released).toEqual([]);
  });

  it("leaves recordings pending when Queue publishing fails", async () => {
    const state = createStore();
    const sendBatch = vi.fn().mockRejectedValue(new Error("Queue unavailable"));

    await expect(
      queueGoogleDriveFiles({
        files: [video("new-file")],
        source: { programId: "program-1" },
        store: state.store,
        queue: { sendBatch },
      })
    ).rejects.toThrow("Queue unavailable");

    expect(state.rows[0].processingStatus).toBe("pending");
    expect(state.claimed).toHaveLength(1);
    expect(state.released).toEqual([[state.created[0].id]]);
  });

  it("does not publish a row claimed by an overlapping scan", async () => {
    const state = createStore([
      {
        id: "pending-recording",
        driveFileId: "pending-file",
        processingStatus: "pending",
      },
    ]);
    const sendBatch = vi.fn().mockResolvedValue(undefined);
    const overlappingStore: RecordingImportStore = {
      ...state.store,
      claimPendingRecordings: vi.fn().mockResolvedValue([]),
    };

    await expect(
      queueGoogleDriveFiles({
        files: [video("pending-file")],
        source: { programId: "program-1" },
        store: overlappingStore,
        queue: { sendBatch },
      })
    ).resolves.toEqual({
      discovered: 1,
      created: 0,
      queued: 0,
      skipped: 1,
    });

    expect(sendBatch).not.toHaveBeenCalled();
  });

  it("handles insert races without queueing a duplicate", async () => {
    const state = createStore([], new Set(["raced-file"]));
    const sendBatch = vi.fn().mockResolvedValue(undefined);

    await expect(
      queueGoogleDriveFiles({
        files: [video("raced-file")],
        source: { programId: "program-1" },
        store: state.store,
        queue: { sendBatch },
      })
    ).resolves.toEqual({
      discovered: 1,
      created: 0,
      queued: 0,
      skipped: 1,
    });
    expect(sendBatch).not.toHaveBeenCalled();
  });

  it("publishes large backlogs in bounded batches", async () => {
    const state = createStore();
    const sendBatch = vi.fn().mockResolvedValue(undefined);
    const files = Array.from({ length: 101 }, (_, index) =>
      video(`file-${String(index).padStart(6, "0")}`)
    );

    const summary = await queueGoogleDriveFiles({
      files,
      source: { programId: "program-1" },
      store: state.store,
      queue: { sendBatch },
    });

    expect(summary.queued).toBe(101);
    expect(sendBatch.mock.calls.map(([messages]) => messages.length)).toEqual([
      50, 50, 1,
    ]);
    expect(state.claimed.map((ids) => ids.length)).toEqual([50, 50, 1]);
  });
});
