import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  drizzle: vi.fn(),
  downloadGoogleDriveVideoToR2: vi.fn(),
  createCredentialCipher: vi.fn(),
  getGoogleDriveCredentials: vi.fn(),
  transcribeAudioChunks: vi.fn(),
  embedAndIndexRecording: vi.fn(),
}));

vi.mock("drizzle-orm/d1", () => ({ drizzle: mocks.drizzle }));
vi.mock("@/lib/recordings/google-drive", () => ({
  downloadGoogleDriveVideoToR2: mocks.downloadGoogleDriveVideoToR2,
}));
vi.mock("@/lib/credentials/crypto", () => ({
  createCredentialCipher: mocks.createCredentialCipher,
}));
vi.mock("@/lib/credentials/google-drive", () => ({
  getGoogleDriveCredentials: mocks.getGoogleDriveCredentials,
}));
vi.mock("@/lib/recordings/transcription", () => ({
  transcribeAudioChunks: mocks.transcribeAudioChunks,
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

function createEnvironment(
  containerFetch: ReturnType<typeof vi.fn>,
  containerStart: ReturnType<typeof vi.fn> = vi.fn(),
  bucketGet: ReturnType<typeof vi.fn> = vi.fn().mockResolvedValue({
    arrayBuffer: vi.fn().mockResolvedValue(new ArrayBuffer(8)),
    httpMetadata: { contentType: "audio/mpeg" },
  })
) {
  return {
    DB: {},
    CREDENTIALS_ENCRYPTION_KEY: "dGVzdC1rZXktMzItYnl0ZXMtZm9yLXVuaXQ=",
    BUCKET: {
      get: bucketGet,
    },
    FFMPEG_CONTAINER: {
      getByName: vi.fn(() => ({ fetch: containerFetch, start: containerStart })),
    },
    AI: {},
    VECTORIZE: {},
  } as unknown as Env;
}

function createTranscriptionChunks(recordingId = "recording1") {
  return [
    {
      chunkIndex: 0,
      r2AudioKey: `recordings/${recordingId}/transcription/chunk-00000.mp3`,
      offsetSeconds: 0,
      durationSeconds: 120,
    },
    {
      chunkIndex: 1,
      r2AudioKey: `recordings/${recordingId}/transcription/chunk-00001.mp3`,
      offsetSeconds: 120,
      durationSeconds: 60,
    },
  ];
}

function createSegmentResponse(recordingId = "recording1") {
  return Response.json({
    r2AudioKey: `recordings/${recordingId}/audio.mp3`,
    durationSeconds: 180,
    transcriptionChunks: createTranscriptionChunks(recordingId),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.createCredentialCipher.mockReturnValue({
    encrypt: vi.fn(),
    decrypt: vi.fn(),
  });
  mocks.getGoogleDriveCredentials.mockResolvedValue({
    clientEmail: "drive@example.iam.gserviceaccount.com",
    privateKey: "key",
  });
  mocks.downloadGoogleDriveVideoToR2.mockResolvedValue({
    r2VideoKey: "recordings/recording1/source.mp4",
    fileSizeBytes: 123,
  });
  mocks.transcribeAudioChunks.mockResolvedValue({
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
        transcriptionChunks: createTranscriptionChunks(),
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
    expect(env.FFMPEG_CONTAINER.getByName).toHaveBeenCalledWith("recording1");
    expect(JSON.parse(String(containerRequest.body))).toMatchObject({
      recordingId: "recording1",
      r2VideoKey: "recordings/recording1/source.mp4",
    });
    expect(containerRequest.signal).toBeInstanceOf(AbortSignal);
  });

  it("starts the named FFmpeg container before proxying the request", async () => {
    const recording: Record<string, unknown> = {
      id: "recording1",
      driveFileId: null,
      r2VideoKey: "recordings/recording1/source.mp4",
      r2AudioKey: null,
      durationSeconds: null,
      fileSizeBytes: 488_585_211,
      processingStatus: "queued",
    };
    const { database } = createDatabase(recording);
    mocks.drizzle.mockReturnValue(database);
    const containerStart = vi.fn();
    const containerFetch = vi.fn().mockResolvedValue(
      Response.json({
        r2VideoKey: "recordings/recording1/source.mp4",
        r2AudioKey: "recordings/recording1/audio.mp3",
        durationSeconds: 60,
        fileSizeBytes: 488_585_211,
        transcriptionChunks: createTranscriptionChunks(),
      })
    );
    const env = createEnvironment(containerFetch, containerStart);

    await processRecordingMessage(
      { type: "process_recording", recordingId: "recording1" },
      env
    );

    expect(containerStart).toHaveBeenCalledBefore(containerFetch);
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

  it("skips the download step when r2VideoKey is already set", async () => {
    const recording: Record<string, unknown> = {
      id: "recording1",
      driveFileId: null,
      r2VideoKey: "recordings/recording1/source.mp4",
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
        durationSeconds: 60,
        fileSizeBytes: 100,
        transcriptionChunks: createTranscriptionChunks(),
      })
    );
    const env = createEnvironment(containerFetch);

    await processRecordingMessage(
      { type: "process_recording", recordingId: "recording1" },
      env
    );

    expect(mocks.downloadGoogleDriveVideoToR2).not.toHaveBeenCalled();
    const statusUpdates = updates
      .filter((update) => "processingStatus" in update)
      .map((update) => update.processingStatus);
    expect(statusUpdates).not.toContain("downloading");
    expect(statusUpdates[0]).toBe("extracting_audio");
  });

  it("segments the extracted MP3 when a legacy container response has no chunks", async () => {
    const recording: Record<string, unknown> = {
      id: "recording1",
      driveFileId: null,
      r2VideoKey: "recordings/recording1/source.mp4",
      r2AudioKey: null,
      durationSeconds: null,
      fileSizeBytes: 488_585_211,
      processingStatus: "queued",
    };
    const { database } = createDatabase(recording);
    mocks.drizzle.mockReturnValue(database);
    const containerFetch = vi
      .fn()
      .mockResolvedValueOnce(
        Response.json({
          r2VideoKey: "recordings/recording1/source.mp4",
          r2AudioKey: "recordings/recording1/audio.mp3",
          durationSeconds: 180,
          fileSizeBytes: 488_585_211,
        })
      )
      .mockResolvedValueOnce(createSegmentResponse());
    const env = createEnvironment(containerFetch);

    await processRecordingMessage(
      { type: "process_recording", recordingId: "recording1" },
      env
    );

    expect(containerFetch).toHaveBeenCalledTimes(2);
    expect(containerFetch.mock.calls.map(([url]) => url)).toEqual([
      "https://ffmpeg/process",
      "https://ffmpeg/segment",
    ]);
    expect(mocks.transcribeAudioChunks).toHaveBeenCalledWith(
      expect.objectContaining({ chunks: createTranscriptionChunks() })
    );
  });

  it("segments an existing audio object without re-extracting the video", async () => {
    const recording: Record<string, unknown> = {
      id: "recording1",
      driveFileId: null,
      r2VideoKey: "recordings/recording1/source.mp4",
      r2AudioKey: "recordings/recording1/audio.mp3",
      durationSeconds: 2793,
      fileSizeBytes: 488_585_211,
      processingStatus: "queued",
    };
    const { database, updates } = createDatabase(recording);
    mocks.drizzle.mockReturnValue(database);
    const containerFetch = vi.fn().mockResolvedValue(createSegmentResponse());
    const env = createEnvironment(containerFetch);

    await processRecordingMessage(
      { type: "process_recording", recordingId: "recording1" },
      env
    );

    expect(containerFetch).toHaveBeenCalledOnce();
    expect(containerFetch).toHaveBeenCalledWith(
      "https://ffmpeg/segment",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({
          recordingId: "recording1",
          r2AudioKey: "recordings/recording1/audio.mp3",
        }),
      })
    );
    expect(mocks.transcribeAudioChunks).toHaveBeenCalledWith(
      expect.objectContaining({ chunks: createTranscriptionChunks() })
    );
    const statusUpdates = updates
      .filter((update) => "processingStatus" in update)
      .map((update) => update.processingStatus);
    expect(statusUpdates).not.toContain("extracting_audio");
    expect(statusUpdates[0]).toBe("transcribing");
  });

  it("checkpoints transcript segments as chunks complete", async () => {
    const recording: Record<string, unknown> = {
      id: "recording1",
      driveFileId: null,
      r2VideoKey: "recordings/recording1/source.mp4",
      r2AudioKey: "recordings/recording1/audio.mp3",
      durationSeconds: 2793,
      fileSizeBytes: 488_585_211,
      processingStatus: "queued",
    };
    const { database } = createDatabase(recording);
    mocks.drizzle.mockReturnValue(database);
    mocks.transcribeAudioChunks.mockImplementation(
      async ({ onChunk }: { onChunk: (chunk: unknown) => Promise<void> }) => {
        await onChunk({
          chunkIndex: 0,
          r2AudioKey:
            "recordings/recording1/transcription/chunk-00000.mp3",
          offsetSeconds: 0,
          durationSeconds: 120,
          audioBytes: 960_000,
          text: "Chunk text",
          segments: [
            {
              id: "segment1",
              startTime: 0,
              endTime: 1,
              text: "Chunk text",
              chunkIndex: 0,
            },
          ],
        });
        return {
          text: "Chunk text",
          vtt: "WEBVTT",
          segments: [
            {
              id: "segment1",
              startTime: 0,
              endTime: 1,
              text: "Chunk text",
              chunkIndex: 0,
            },
          ],
        };
      }
    );
    const env = createEnvironment(
      vi.fn().mockResolvedValue(createSegmentResponse())
    );

    await processRecordingMessage(
      { type: "process_recording", recordingId: "recording1" },
      env
    );

    expect(database.delete).toHaveBeenCalled();
    expect(database.insert).toHaveBeenCalled();
  });

  it("loads the container-produced R2 chunk instead of the full MP3", async () => {
    const recording: Record<string, unknown> = {
      id: "recording1",
      driveFileId: null,
      r2VideoKey: "recordings/recording1/source.mp4",
      r2AudioKey: "recordings/recording1/audio.mp3",
      durationSeconds: 180,
      fileSizeBytes: 488_585_211,
      processingStatus: "queued",
    };
    const { database } = createDatabase(recording);
    mocks.drizzle.mockReturnValue(database);
    const bucketGet = vi.fn().mockResolvedValue({
      arrayBuffer: vi.fn().mockResolvedValue(new ArrayBuffer(960_000)),
      httpMetadata: { contentType: "audio/mpeg" },
    });
    mocks.transcribeAudioChunks.mockImplementation(
      async ({ chunks, loadAudio }) => {
        const loaded = await loadAudio(chunks[0]);
        expect(loaded.audio.byteLength).toBe(960_000);
        expect(loaded.contentType).toBe("audio/mpeg");
        return { text: "Transcript", vtt: "WEBVTT", segments: [] };
      }
    );
    const env = createEnvironment(
      vi.fn().mockResolvedValue(createSegmentResponse()),
      vi.fn(),
      bucketGet
    );

    await processRecordingMessage(
      { type: "process_recording", recordingId: "recording1" },
      env
    );

    expect(bucketGet).toHaveBeenCalledOnce();
    expect(bucketGet).toHaveBeenCalledWith(
      "recordings/recording1/transcription/chunk-00000.mp3"
    );
    expect(bucketGet).not.toHaveBeenCalledWith(
      "recordings/recording1/audio.mp3"
    );
  });

  it("fails clearly when a generated transcription chunk is missing from R2", async () => {
    const recording: Record<string, unknown> = {
      id: "recording1",
      driveFileId: null,
      r2VideoKey: "recordings/recording1/source.mp4",
      r2AudioKey: "recordings/recording1/audio.mp3",
      durationSeconds: 180,
      fileSizeBytes: 488_585_211,
      processingStatus: "queued",
    };
    const { database, updates } = createDatabase(recording);
    mocks.drizzle.mockReturnValue(database);
    mocks.transcribeAudioChunks.mockImplementation(
      async ({ chunks, loadAudio }) => {
        await loadAudio(chunks[0]);
      }
    );
    const env = createEnvironment(
      vi.fn().mockResolvedValue(createSegmentResponse()),
      vi.fn(),
      vi.fn().mockResolvedValue(null)
    );

    await expect(
      processRecordingMessage(
        { type: "process_recording", recordingId: "recording1" },
        env
      )
    ).rejects.toThrow(
      "Audio chunk recordings/recording1/transcription/chunk-00000.mp3 not found"
    );
    expect(updates.at(-1)).toMatchObject({
      processingStatus: "failed",
      processingError:
        "Audio chunk recordings/recording1/transcription/chunk-00000.mp3 not found",
    });
  });

  it("fails the recording when the FFmpeg container request times out", async () => {
    vi.useFakeTimers();
    try {
      const recording: Record<string, unknown> = {
        id: "recording1",
        driveFileId: null,
        r2VideoKey: "recordings/recording1/source.mp4",
        r2AudioKey: null,
        durationSeconds: null,
        fileSizeBytes: 488_585_211,
        processingStatus: "queued",
      };
      const { database, updates } = createDatabase(recording);
      mocks.drizzle.mockReturnValue(database);
      const containerFetch = vi.fn(
        async (_url: string, init?: RequestInit) =>
          await new Promise<Response>((_resolve, reject) => {
            init?.signal?.addEventListener("abort", () =>
              reject(new Error("aborted"))
            );
          })
      );
      const env = createEnvironment(containerFetch);

      const processing = processRecordingMessage(
        { type: "process_recording", recordingId: "recording1" },
        env
      );
      const rejection = processing.catch((error: unknown) => error);
      await vi.advanceTimersByTimeAsync(25 * 60 * 1000);

      const error = await rejection;
      expect(error).toBeInstanceOf(Error);
      expect((error as Error).message).toBe(
        "FFmpeg container timed out after 1500000ms"
      );
      expect(updates.at(-1)).toMatchObject({
        processingStatus: "failed",
        processingError: "FFmpeg container timed out after 1500000ms",
      });
    } finally {
      vi.useRealTimers();
    }
  });

  it("acks an automatic retry after a timeout without resetting the failure", async () => {
    const recording: Record<string, unknown> = {
      id: "recording1",
      driveFileId: null,
      r2VideoKey: "recordings/recording1/source.mp4",
      r2AudioKey: null,
      durationSeconds: null,
      fileSizeBytes: 488_585_211,
      processingStatus: "failed",
      processingError: "FFmpeg container timed out after 1500000ms",
    };
    const { database, updates } = createDatabase(recording);
    mocks.drizzle.mockReturnValue(database);
    const containerFetch = vi.fn();
    const env = createEnvironment(containerFetch);

    await processRecordingMessage(
      { type: "process_recording", recordingId: "recording1" },
      env
    );

    expect(containerFetch).not.toHaveBeenCalled();
    expect(updates).toEqual([]);
    expect(recording).toMatchObject({
      processingStatus: "failed",
      processingError: "FFmpeg container timed out after 1500000ms",
    });
  });

  it("fails the recording when transcription times out", async () => {
    vi.useFakeTimers();
    try {
      const recording: Record<string, unknown> = {
        id: "recording1",
        driveFileId: null,
        r2VideoKey: "recordings/recording1/source.mp4",
        r2AudioKey: "recordings/recording1/audio.mp3",
        durationSeconds: 2793,
        fileSizeBytes: 488_585_211,
        processingStatus: "queued",
      };
      const { database, updates } = createDatabase(recording);
      mocks.drizzle.mockReturnValue(database);
      mocks.transcribeAudioChunks.mockImplementation(
        async () => await new Promise(() => {})
      );
      const containerFetch = vi
        .fn()
        .mockResolvedValue(createSegmentResponse());
      const env = createEnvironment(containerFetch);

      const processing = processRecordingMessage(
        { type: "process_recording", recordingId: "recording1" },
        env
      );
      const rejection = processing.catch((error: unknown) => error);
      await vi.advanceTimersByTimeAsync(12 * 60 * 1000);

      const error = await rejection;
      expect(error).toBeInstanceOf(Error);
      expect((error as Error).message).toBe(
        "Transcription timed out after 720000ms"
      );
      expect(containerFetch).toHaveBeenCalledWith(
        "https://ffmpeg/segment",
        expect.any(Object)
      );
      expect(updates.at(-1)).toMatchObject({
        processingStatus: "failed",
        processingError: "Transcription timed out after 720000ms",
      });
    } finally {
      vi.useRealTimers();
    }
  });
});
