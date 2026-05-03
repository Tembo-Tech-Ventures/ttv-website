import { drizzle } from "drizzle-orm/d1";
import { eq } from "drizzle-orm";
import * as schema from "@/lib/db/schema";
import { embedAndIndexRecording } from "@/lib/recordings/embeddings";
import { transcribeAudioObject } from "@/lib/recordings/transcription";

export interface RecordingQueueMessage {
  type: "process_recording";
  recordingId: string;
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
  db: any,
  recordingId: string,
  processingStatus: typeof schema.recording.$inferSelect.processingStatus,
  processingError: string | null = null
) {
  await db
    .update(schema.recording)
    .set({ processingStatus, processingError })
    .where(eq(schema.recording.id, recordingId));
}

export async function processRecordingMessage(message: unknown, env: Env) {
  if (!isRecordingQueueMessage(message)) {
    throw new Error("Unknown recording queue message");
  }

  const db = drizzle(env.DB, { schema });
  const recording = await db.query.recording.findFirst({
    where: eq(schema.recording.id, message.recordingId),
  });

  if (!recording) {
    throw new Error(`Recording ${message.recordingId} not found`);
  }
  if (!recording.r2VideoKey) {
    throw new Error(`Recording ${recording.id} does not have an R2 video key`);
  }

  try {
    await updateStatus(db, recording.id, "extracting_audio");
    const container = env.FFMPEG_CONTAINER.getByName(recording.id);
    const ffmpegResponse = await container.fetch("https://ffmpeg/process", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        recordingId: recording.id,
        r2VideoKey: recording.r2VideoKey,
      }),
    });

    if (!ffmpegResponse.ok) {
      throw new Error(`FFmpeg container failed: ${await ffmpegResponse.text()}`);
    }

    const ffmpegResult = (await ffmpegResponse.json()) as {
      r2VideoKey: string;
      r2AudioKey: string;
      durationSeconds?: number;
      fileSizeBytes?: number;
    };

    await db
      .update(schema.recording)
      .set({
        r2VideoKey: ffmpegResult.r2VideoKey,
        r2AudioKey: ffmpegResult.r2AudioKey,
        durationSeconds: ffmpegResult.durationSeconds ?? recording.durationSeconds,
        fileSizeBytes: ffmpegResult.fileSizeBytes ?? recording.fileSizeBytes,
      })
      .where(eq(schema.recording.id, recording.id));

    await updateStatus(db, recording.id, "transcribing");
    const audio = await env.BUCKET.get(ffmpegResult.r2AudioKey);
    if (!audio) {
      throw new Error(`Audio object ${ffmpegResult.r2AudioKey} not found`);
    }

    const transcript = await transcribeAudioObject({
      env,
      audio: await audio.arrayBuffer(),
    });

    await db
      .delete(schema.transcriptSegment)
      .where(eq(schema.transcriptSegment.recordingId, recording.id));
    if (transcript.segments.length > 0) {
      await db.insert(schema.transcriptSegment).values(
        transcript.segments.map((segment) => ({
          ...segment,
          recordingId: recording.id,
        }))
      );
    }

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
    await updateStatus(
      db,
      recording.id,
      "failed",
      error instanceof Error ? error.message : String(error)
    );
    throw error;
  }
}
