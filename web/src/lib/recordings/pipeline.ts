import { drizzle } from "drizzle-orm/d1";
import { eq } from "drizzle-orm";
import * as schema from "@/lib/db/schema";
import type { Database } from "@/lib/db/schema";
import { embedAndIndexRecording } from "@/lib/recordings/embeddings";
import {
  transcribeAudioChunks,
  type TranscriptionAudioChunk,
} from "@/lib/recordings/transcription";
import {
  downloadGoogleDriveVideoToR2,
  type GoogleDriveCredentials,
} from "@/lib/recordings/google-drive";
import { createCredentialCipher } from "@/lib/credentials/crypto";
import { getGoogleDriveCredentials } from "@/lib/credentials/google-drive";

export interface RecordingQueueMessage {
  type: "process_recording";
  recordingId: string;
}

const FFMPEG_CONTAINER_TIMEOUT_MS = 25 * 60 * 1000;
const FFMPEG_TIMEOUT_ERROR_PREFIX = "FFmpeg container timed out";
const TRANSCRIPTION_TIMEOUT_MS = 12 * 60 * 1000;
const TRANSCRIPTION_TIMEOUT_ERROR_PREFIX = "Transcription timed out";
const TRANSCRIPT_SEGMENT_INSERT_BATCH_SIZE = 10;

type StartableContainer = DurableObjectStub & {
  start(): void;
};

interface FfmpegResult {
  r2VideoKey: string;
  r2AudioKey: string;
  durationSeconds?: number;
  fileSizeBytes?: number;
  transcriptionChunks: TranscriptionAudioChunk[] | null;
}

function logRecordingPipelineEvent(
  event: string,
  fields: Record<string, unknown>
) {
  console.log(
    JSON.stringify({
      event,
      component: "recording_pipeline",
      ...fields,
    })
  );
}

function elapsedMs(startedAt: number) {
  return Math.round(performance.now() - startedAt);
}

function chunkArray<T>(items: T[], size: number) {
  const chunks: T[][] = [];
  for (let index = 0; index < items.length; index += size) {
    chunks.push(items.slice(index, index + size));
  }
  return chunks;
}

function isRetryableTerminalError(value: unknown) {
  return (
    typeof value === "string" &&
    (value.startsWith(FFMPEG_TIMEOUT_ERROR_PREFIX) ||
      value.startsWith(TRANSCRIPTION_TIMEOUT_ERROR_PREFIX))
  );
}

function parseTranscriptionChunks(
  value: unknown,
  recordingId: string
): TranscriptionAudioChunk[] | null {
  if (value === undefined) return null;
  if (!Array.isArray(value) || value.length === 0) {
    throw new Error("FFmpeg container returned no transcription chunks");
  }

  const expectedKeyPrefix = `recordings/${recordingId}/transcription/`;
  return value.map((item, index) => {
    if (typeof item !== "object" || item === null) {
      throw new Error(`FFmpeg container returned invalid transcription chunk ${index}`);
    }
    const chunk = item as Record<string, unknown>;
    if (
      chunk.chunkIndex !== index ||
      typeof chunk.r2AudioKey !== "string" ||
      !chunk.r2AudioKey.startsWith(expectedKeyPrefix) ||
      typeof chunk.offsetSeconds !== "number" ||
      !Number.isFinite(chunk.offsetSeconds) ||
      chunk.offsetSeconds < 0 ||
      typeof chunk.durationSeconds !== "number" ||
      !Number.isFinite(chunk.durationSeconds) ||
      chunk.durationSeconds <= 0
    ) {
      throw new Error(`FFmpeg container returned invalid transcription chunk ${index}`);
    }
    return {
      chunkIndex: chunk.chunkIndex,
      r2AudioKey: chunk.r2AudioKey,
      offsetSeconds: chunk.offsetSeconds,
      durationSeconds: chunk.durationSeconds,
    };
  });
}

async function withTimeout<T>({
  timeoutMs,
  errorMessage,
  run,
}: {
  timeoutMs: number;
  errorMessage: string;
  run: (signal: AbortSignal) => Promise<T>;
}) {
  const abortController = new AbortController();
  let timeout: ReturnType<typeof setTimeout> | undefined;
  const timeoutPromise = new Promise<never>((_resolve, reject) => {
    timeout = setTimeout(() => {
      abortController.abort();
      reject(new Error(errorMessage));
    }, timeoutMs);
  });

  try {
    return await Promise.race([run(abortController.signal), timeoutPromise]);
  } finally {
    if (timeout) clearTimeout(timeout);
  }
}

function isRecordingQueueMessage(value: unknown): value is RecordingQueueMessage {
  return (
    typeof value === "object" &&
    value !== null &&
    (value as { type?: unknown }).type === "process_recording" &&
    typeof (value as { recordingId?: unknown }).recordingId === "string"
  );
}

async function updateStatus(
  db: Database,
  recordingId: string,
  processingStatus: typeof schema.recording.$inferSelect.processingStatus,
  processingError: string | null = null
) {
  await db
    .update(schema.recording)
    .set({ processingStatus, processingError })
    .where(eq(schema.recording.id, recordingId));
}

async function resolveGoogleDriveCredentials(
  env: Env,
  db: Database
): Promise<GoogleDriveCredentials | null> {
  if (!env.CREDENTIALS_ENCRYPTION_KEY) return null;
  const cipher = createCredentialCipher(env);
  return getGoogleDriveCredentials(db, cipher);
}

async function segmentExistingAudio({
  container,
  recordingId,
  r2AudioKey,
}: {
  container: StartableContainer;
  recordingId: string;
  r2AudioKey: string;
}) {
  const startedAt = performance.now();
  logRecordingPipelineEvent("ffmpeg_audio_segment_fetch_start", {
    recordingId,
    r2AudioKey,
    timeoutMs: FFMPEG_CONTAINER_TIMEOUT_MS,
  });
  const response = await withTimeout({
    timeoutMs: FFMPEG_CONTAINER_TIMEOUT_MS,
    errorMessage: `FFmpeg container timed out after ${FFMPEG_CONTAINER_TIMEOUT_MS}ms`,
    run: async (signal) =>
      await container.fetch("https://ffmpeg/segment", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ recordingId, r2AudioKey }),
        signal,
      }),
  });
  logRecordingPipelineEvent("ffmpeg_audio_segment_fetch_done", {
    recordingId,
    r2AudioKey,
    status: response.status,
    ok: response.ok,
    elapsedMs: elapsedMs(startedAt),
  });
  if (!response.ok) {
    throw new Error(
      `FFmpeg container failed to segment audio: ${await response.text()}`
    );
  }

  const result = (await response.json()) as {
    durationSeconds?: number;
    transcriptionChunks?: unknown;
  };
  const transcriptionChunks = parseTranscriptionChunks(
    result.transcriptionChunks,
    recordingId
  );
  if (!transcriptionChunks) {
    throw new Error("FFmpeg container did not return transcription chunks");
  }
  return {
    durationSeconds: result.durationSeconds,
    transcriptionChunks,
  };
}

export async function processRecordingMessage(message: unknown, env: Env) {
  if (!isRecordingQueueMessage(message)) {
    throw new Error("Unknown recording queue message");
  }

  logRecordingPipelineEvent("queue_message_received", {
    recordingId: message.recordingId,
  });

  const db = drizzle(env.DB, { schema });
  const recording = await db.query.recording.findFirst({
    where: eq(schema.recording.id, message.recordingId),
  });

  if (!recording) {
    throw new Error(`Recording ${message.recordingId} not found`);
  }

  if (
    recording.processingStatus === "failed" &&
    isRetryableTerminalError(recording.processingError)
  ) {
    logRecordingPipelineEvent("queue_retry_skipped_after_terminal_error", {
      recordingId: recording.id,
      processingError: recording.processingError,
    });
    return;
  }

  try {
    let r2VideoKey = recording.r2VideoKey;
    let fileSizeBytes = recording.fileSizeBytes;

    if (!r2VideoKey && recording.driveFileId) {
      await updateStatus(db, recording.id, "downloading");
      logRecordingPipelineEvent("drive_download_start", {
        recordingId: recording.id,
        driveFileId: recording.driveFileId,
      });
      const downloadStartedAt = performance.now();
      const credentials = await resolveGoogleDriveCredentials(env, db);
      if (!credentials) {
        throw new Error("Google Drive credentials are not configured");
      }
      const download = await downloadGoogleDriveVideoToR2({
        env,
        credentials,
        fileId: recording.driveFileId,
        recordingId: recording.id,
      });
      r2VideoKey = download.r2VideoKey;
      fileSizeBytes = download.fileSizeBytes ?? fileSizeBytes;
      logRecordingPipelineEvent("drive_download_done", {
        recordingId: recording.id,
        r2VideoKey,
        fileSizeBytes,
        elapsedMs: elapsedMs(downloadStartedAt),
      });
      await db
        .update(schema.recording)
        .set({ r2VideoKey, fileSizeBytes })
        .where(eq(schema.recording.id, recording.id));
    }

    if (!r2VideoKey) {
      throw new Error(`Recording ${recording.id} does not have a video source`);
    }

    let container: StartableContainer | undefined;
    const getStartedContainer = () => {
      if (!container) {
        container = env.FFMPEG_CONTAINER.getByName(
          recording.id
        ) as StartableContainer;
        container.start();
      }
      return container;
    };

    let ffmpegResult: FfmpegResult;

    if (recording.r2AudioKey) {
      ffmpegResult = {
        r2VideoKey,
        r2AudioKey: recording.r2AudioKey,
        durationSeconds: recording.durationSeconds ?? undefined,
        fileSizeBytes: recording.fileSizeBytes ?? fileSizeBytes ?? undefined,
        transcriptionChunks: null,
      };
      logRecordingPipelineEvent("ffmpeg_container_skipped_existing_audio", {
        recordingId: recording.id,
        r2VideoKey,
        r2AudioKey: recording.r2AudioKey,
        durationSeconds: recording.durationSeconds,
        fileSizeBytes: recording.fileSizeBytes ?? fileSizeBytes,
      });
    } else {
      await updateStatus(db, recording.id, "extracting_audio");
      const ffmpegContainer = getStartedContainer();
      const containerStartedAt = performance.now();
      logRecordingPipelineEvent("ffmpeg_container_fetch_start", {
        recordingId: recording.id,
        r2VideoKey,
        fileSizeBytes,
        timeoutMs: FFMPEG_CONTAINER_TIMEOUT_MS,
      });

      const ffmpegResponse = await withTimeout({
        timeoutMs: FFMPEG_CONTAINER_TIMEOUT_MS,
        errorMessage: `FFmpeg container timed out after ${FFMPEG_CONTAINER_TIMEOUT_MS}ms`,
        run: async (signal) =>
          await ffmpegContainer.fetch("https://ffmpeg/process", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({
              recordingId: recording.id,
              r2VideoKey,
            }),
            signal,
          }),
      });

      logRecordingPipelineEvent("ffmpeg_container_fetch_done", {
        recordingId: recording.id,
        status: ffmpegResponse.status,
        ok: ffmpegResponse.ok,
        elapsedMs: elapsedMs(containerStartedAt),
      });

      if (!ffmpegResponse.ok) {
        throw new Error(`FFmpeg container failed: ${await ffmpegResponse.text()}`);
      }

      const rawFfmpegResult = (await ffmpegResponse.json()) as Omit<
        FfmpegResult,
        "transcriptionChunks"
      > & { transcriptionChunks?: unknown };
      ffmpegResult = {
        ...rawFfmpegResult,
        transcriptionChunks: parseTranscriptionChunks(
          rawFfmpegResult.transcriptionChunks,
          recording.id
        ),
      };
      logRecordingPipelineEvent("ffmpeg_container_result", {
        recordingId: recording.id,
        r2VideoKey: ffmpegResult.r2VideoKey,
        r2AudioKey: ffmpegResult.r2AudioKey,
        durationSeconds: ffmpegResult.durationSeconds,
        fileSizeBytes: ffmpegResult.fileSizeBytes,
        elapsedMs: elapsedMs(containerStartedAt),
      });

      await db
        .update(schema.recording)
        .set({
          r2VideoKey: ffmpegResult.r2VideoKey,
          r2AudioKey: ffmpegResult.r2AudioKey,
          durationSeconds:
            ffmpegResult.durationSeconds ?? recording.durationSeconds,
          fileSizeBytes: ffmpegResult.fileSizeBytes ?? recording.fileSizeBytes,
        })
        .where(eq(schema.recording.id, recording.id));
    }

    await updateStatus(db, recording.id, "transcribing");
    let transcriptionChunks = ffmpegResult.transcriptionChunks;
    if (!transcriptionChunks) {
      const segmented = await segmentExistingAudio({
        container: getStartedContainer(),
        recordingId: recording.id,
        r2AudioKey: ffmpegResult.r2AudioKey,
      });
      transcriptionChunks = segmented.transcriptionChunks;
      if (!ffmpegResult.durationSeconds && segmented.durationSeconds) {
        ffmpegResult.durationSeconds = segmented.durationSeconds;
        await db
          .update(schema.recording)
          .set({ durationSeconds: segmented.durationSeconds })
          .where(eq(schema.recording.id, recording.id));
      }
    }

    const transcriptionStartedAt = performance.now();
    logRecordingPipelineEvent("transcription_start", {
      recordingId: recording.id,
      r2AudioKey: ffmpegResult.r2AudioKey,
      chunkCount: transcriptionChunks.length,
      timeoutMs: TRANSCRIPTION_TIMEOUT_MS,
    });
    await db
      .delete(schema.transcriptSegment)
      .where(eq(schema.transcriptSegment.recordingId, recording.id));
    const transcript = await withTimeout({
      timeoutMs: TRANSCRIPTION_TIMEOUT_MS,
      errorMessage: `Transcription timed out after ${TRANSCRIPTION_TIMEOUT_MS}ms`,
      run: async () =>
        await transcribeAudioChunks({
          env,
          chunks: transcriptionChunks,
          loadAudio: async (chunk) => {
            const audio = await env.BUCKET.get(chunk.r2AudioKey);
            if (!audio) {
              throw new Error(`Audio chunk ${chunk.r2AudioKey} not found`);
            }
            return {
              audio: await audio.arrayBuffer(),
              contentType: audio.httpMetadata?.contentType,
            };
          },
          onChunk: async (chunk) => {
            logRecordingPipelineEvent("transcription_chunk_done", {
              recordingId: recording.id,
              chunkIndex: chunk.chunkIndex,
              r2AudioKey: chunk.r2AudioKey,
              offsetSeconds: Math.round(chunk.offsetSeconds),
              durationSeconds: Math.round(chunk.durationSeconds),
              audioBytes: chunk.audioBytes,
              segmentCount: chunk.segments.length,
              textLength: chunk.text.length,
            });
            if (chunk.segments.length > 0) {
              const segmentValues = chunk.segments.map((segment) => ({
                ...segment,
                recordingId: recording.id,
              }));
              for (const batch of chunkArray(
                segmentValues,
                TRANSCRIPT_SEGMENT_INSERT_BATCH_SIZE
              )) {
                await db.insert(schema.transcriptSegment).values(batch);
              }
            }
          },
        }),
    });
    logRecordingPipelineEvent("transcription_done", {
      recordingId: recording.id,
      segmentCount: transcript.segments.length,
      textLength: transcript.text.length,
      elapsedMs: elapsedMs(transcriptionStartedAt),
    });

    await db
      .update(schema.recording)
      .set({
        transcriptText: transcript.text,
        transcriptVtt: transcript.vtt,
      })
      .where(eq(schema.recording.id, recording.id));

    await updateStatus(db, recording.id, "embedding");
    const updatedRecording = await db.query.recording.findFirst({
      where: eq(schema.recording.id, recording.id),
    });
    if (!updatedRecording) {
      throw new Error(`Recording ${recording.id} disappeared during processing`);
    }
    await embedAndIndexRecording({ db, env, recording: updatedRecording });

    await updateStatus(db, recording.id, "complete");
  } catch (error) {
    logRecordingPipelineEvent("recording_pipeline_failed", {
      recordingId: recording.id,
      error: error instanceof Error ? error.message : String(error),
    });
    await updateStatus(
      db,
      recording.id,
      "failed",
      error instanceof Error ? error.message : String(error)
    );
    throw error;
  }
}
