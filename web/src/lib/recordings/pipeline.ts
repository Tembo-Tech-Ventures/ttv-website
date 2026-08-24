import { drizzle } from "drizzle-orm/d1";
import { eq } from "drizzle-orm";
import * as schema from "@/lib/db/schema";
import type { Database } from "@/lib/db/schema";
import { embedAndIndexRecording } from "@/lib/recordings/embeddings";
import { transcribeAudioObject } from "@/lib/recordings/transcription";
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

type StartableContainer = DurableObjectStub & {
  start(): void;
};

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

function isRetryableTerminalError(value: unknown) {
  return (
    typeof value === "string" &&
    (value.startsWith(FFMPEG_TIMEOUT_ERROR_PREFIX) ||
      value.startsWith(TRANSCRIPTION_TIMEOUT_ERROR_PREFIX))
  );
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

    let ffmpegResult: {
      r2VideoKey: string;
      r2AudioKey: string;
      durationSeconds?: number;
      fileSizeBytes?: number;
    };

    if (recording.r2AudioKey) {
      ffmpegResult = {
        r2VideoKey,
        r2AudioKey: recording.r2AudioKey,
        durationSeconds: recording.durationSeconds ?? undefined,
        fileSizeBytes: recording.fileSizeBytes ?? fileSizeBytes ?? undefined,
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
      const container = env.FFMPEG_CONTAINER.getByName(
        recording.id
      ) as StartableContainer;
      container.start();
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
          await container.fetch("https://ffmpeg/process", {
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

      ffmpegResult = (await ffmpegResponse.json()) as typeof ffmpegResult;
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
    const audio = await env.BUCKET.get(ffmpegResult.r2AudioKey);
    if (!audio) {
      throw new Error(`Audio object ${ffmpegResult.r2AudioKey} not found`);
    }

    const audioBuffer = await audio.arrayBuffer();
    const transcriptionStartedAt = performance.now();
    logRecordingPipelineEvent("transcription_start", {
      recordingId: recording.id,
      r2AudioKey: ffmpegResult.r2AudioKey,
      audioBytes: audioBuffer.byteLength,
      timeoutMs: TRANSCRIPTION_TIMEOUT_MS,
    });
    await db
      .delete(schema.transcriptSegment)
      .where(eq(schema.transcriptSegment.recordingId, recording.id));
    const transcript = await withTimeout({
      timeoutMs: TRANSCRIPTION_TIMEOUT_MS,
      errorMessage: `Transcription timed out after ${TRANSCRIPTION_TIMEOUT_MS}ms`,
      run: async () =>
        await transcribeAudioObject({
          env,
          audio: audioBuffer,
          durationSeconds: ffmpegResult.durationSeconds,
          onChunk: async (chunk) => {
            logRecordingPipelineEvent("transcription_chunk_done", {
              recordingId: recording.id,
              chunkIndex: chunk.chunkIndex,
              byteStart: chunk.byteStart,
              byteEnd: chunk.byteEnd,
              offsetSeconds: Math.round(chunk.offsetSeconds),
              segmentCount: chunk.segments.length,
              textLength: chunk.text.length,
            });
            if (chunk.segments.length > 0) {
              await db.insert(schema.transcriptSegment).values(
                chunk.segments.map((segment) => ({
                  ...segment,
                  recordingId: recording.id,
                }))
              );
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
