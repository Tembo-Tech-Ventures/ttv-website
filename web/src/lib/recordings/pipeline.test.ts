import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  drizzle: vi.fn(),
  downloadGoogleDriveVideoToR2: vi.fn(),
  getGoogleDriveCredentials: vi.fn(),
  transcribeAudioObject: vi.fn(),
  embedAndIndexRecording: vi.fn(),
}));

vi.mock("drizzle-orm/d1", () => ({ drizzle: mocks.drizzle }));
vi.mock("@/lib/recordings/google-drive", () => ({
  downloadGoogleDriveVideoToR2: mocks.downloadGoogleDriveVideoToR2,
  getGoogleDriveCredentials: mocks.getGoogleDriveCredentials,
}));
vi.mock("@/lib/recordings/transcription", () => ({
  transcribeAudioObject: mocks.transcribeAudioObject,
}));
vi.mock("@/lib/recordings/embeddings", () => ({
  embedAndIndexRecording: mocks.embedAndIndexRecording,
}));

import { processRecordingMessage } from "./pipeline";

function createDatabase(recording: Record<string, unknown>) {
  const updates: Array<Record<string, unknown>> = [];
  const update = vi.fn(() => ({
    set: vi.fn((values: Record<string, unknown>) => ({
      where: vi.fn(async () => {
        updates.push(values);
        Object.assign(recording, values);
      }),
    })),
  }));
  const remove = vi.fn(() => ({
    where: vi.fn().mockResolvedValue(undefined),
  }));
  const insert = vi.fn(() => ({
    values: vi.fn().mockResolvedValue(undefined),
  }));
  const database = {
    query: {
      recording: {
        findFirst: vi.fn(async () => recording),
      },
    },
    update,
    delete: remove,
    insert,
  };
  return { database, updates };
}

function createEnvironment(containerFetch: ReturnType<typeof vi.fn>) {
  return {
    DB: {},
    BUCKET: {
      get: vi.fn().mockResolvedValue({
        arrayBuffer: vi.fn().mockResolvedValue(new ArrayBuffer(8)),
      }),
    },
    FFMPEG_CONTAINER: {
      getByName: vi.fn(() => ({ fetch: containerFetch })),
    },
    AI: {},
    VECTORIZE: {},
  } as unknown as Env;
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.getGoogleDriveCredentials.mockReturnValue({
    clientEmail: "drive@example.iam.gserviceaccount.com",
    privateKey: "key",
  });
  mocks.downloadGoogleDriveVideoToR2.mockResolvedValue({
    r2VideoKey: "recordings/recording1/source.mp4",
    fileSizeBytes: 123,
  });
  mocks.transcribeAudioObject.mockResolvedValue({
    text: "Transcript",
    vtt: "WEBVTT",
    segments: [],
  });
  mocks.embedAndIndexRecording.mockResolvedValue(undefined);
});

describe("recording processing pipeline", () => {
  it("downloads a Drive-backed recording before existing processing stages", async () => {
    const recording: Record<string, unknown> = {
      id: "recording1",
      driveFileId: "drive-file-1",
      r2VideoKey: null,
      r2AudioKey: null,
      durationSeconds: null,
      fileSizeBytes: null,
      processingStatus: "queued",
    };
    const { database, updates } = createDatabase(recording);
    mocks.drizzle.mockReturnValue(database);
    const containerFetch = vi.fn().mockResolvedValue(
      Response.json({
        r2VideoKey: "recordings/recording1/source.faststart.mp4",
        r2AudioKey: "recordings/recording1/audio.mp3",
        durationSeconds: 3600,
        fileSizeBytes: 120,
      })
    );
    const env = createEnvironment(containerFetch);

    await processRecordingMessage(
      { type: "process_recording", recordingId: "recording1" },
      env
    );

    expect(mocks.downloadGoogleDriveVideoToR2).toHaveBeenCalledWith({
      env,
      credentials: expect.objectContaining({
        clientEmail: "drive@example.iam.gserviceaccount.com",
      }),
      fileId: "drive-file-1",
      recordingId: "recording1",
    });
    expect(
      updates
        .filter((update) => "processingStatus" in update)
        .map((update) => update.processingStatus)
    ).toEqual([
      "downloading",
      "extracting_audio",
      "transcribing",
      "embedding",
      "complete",
    ]);
    const containerRequest = containerFetch.mock.calls[0][1] as RequestInit;
    expect(JSON.parse(String(containerRequest.body))).toMatchObject({
      recordingId: "recording1",
      r2VideoKey: "recordings/recording1/source.mp4",
    });
  });

  it("records a failure when a queued row has no upload or Drive source", async () => {
    const recording: Record<string, unknown> = {
      id: "recording1",
      driveFileId: null,
      r2VideoKey: null,
      processingStatus: "queued",
    };
    const { database, updates } = createDatabase(recording);
    mocks.drizzle.mockReturnValue(database);
    const env = createEnvironment(vi.fn());

    await expect(
      processRecordingMessage(
        { type: "process_recording", recordingId: "recording1" },
        env
      )
    ).rejects.toThrow("does not have a video source");

    expect(updates.at(-1)).toMatchObject({
      processingStatus: "failed",
      processingError: "Recording recording1 does not have a video source",
    });
  });
});
