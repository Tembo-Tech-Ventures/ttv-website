import { createId } from "@paralleldrive/cuid2";
import { drizzle } from "drizzle-orm/d1";
import { and, eq, inArray, isNotNull } from "drizzle-orm";
import * as schema from "@/lib/db/schema";
import type { Database } from "@/lib/db/schema";
import { createCredentialCipher } from "@/lib/credentials/crypto";
import { getGoogleDriveCredentials } from "@/lib/credentials/google-drive";
import {
  listGoogleDriveVideoFiles,
  titleFromGoogleDriveFileName,
  type GoogleDriveVideoFile,
} from "@/lib/recordings/google-drive";
import type { RecordingQueueMessage } from "@/lib/recordings/pipeline";

type RecordingStatus =
  typeof schema.recording.$inferSelect.processingStatus;
type RecordingImportSource =
  typeof schema.recordingImportSource.$inferSelect;

export interface KnownDriveRecording {
  id: string;
  driveFileId: string;
  processingStatus: RecordingStatus;
}

export interface RecordingImportStore {
  listKnownDriveRecordings(): Promise<KnownDriveRecording[]>;
  createPendingRecording(input: {
    id: string;
    programId: string;
    driveFileId: string;
    title: string;
    recordedAt?: Date;
    fileSizeBytes?: number;
  }): Promise<KnownDriveRecording | null>;
  claimPendingRecordings(ids: string[]): Promise<string[]>;
  releasePendingRecordings(ids: string[]): Promise<void>;
}

export interface RecordingImportQueue {
  sendBatch(
    messages: Array<{ body: RecordingQueueMessage }>
  ): Promise<void>;
}

export interface RecordingImportSummary {
  discovered: number;
  created: number;
  queued: number;
  skipped: number;
}

const QUEUE_BATCH_SIZE = 50;

function chunks<T>(values: T[], size: number): T[][] {
  const result: T[][] = [];
  for (let index = 0; index < values.length; index += size) {
    result.push(values.slice(index, index + size));
  }
  return result;
}

export async function queueGoogleDriveFiles({
  files,
  source,
  store,
  queue,
}: {
  files: GoogleDriveVideoFile[];
  source: Pick<RecordingImportSource, "programId">;
  store: RecordingImportStore;
  queue: RecordingImportQueue;
}): Promise<RecordingImportSummary> {
  const known = new Map(
    (await store.listKnownDriveRecordings()).map((recording) => [
      recording.driveFileId,
      recording,
    ])
  );
  const toQueue: string[] = [];
  let created = 0;
  let skipped = 0;

  for (const file of files) {
    const existing = known.get(file.id);
    if (existing) {
      if (existing.processingStatus === "pending") {
        toQueue.push(existing.id);
      } else {
        skipped += 1;
      }
      continue;
    }

    const inserted = await store.createPendingRecording({
      id: createId(),
      programId: source.programId,
      driveFileId: file.id,
      title: titleFromGoogleDriveFileName(file.name),
      recordedAt: file.createdAt ?? file.modifiedAt,
      fileSizeBytes: file.sizeBytes,
    });
    if (!inserted) {
      skipped += 1;
      continue;
    }

    known.set(file.id, inserted);
    created += 1;
    toQueue.push(inserted.id);
  }

  let queued = 0;
  for (const batch of chunks(toQueue, QUEUE_BATCH_SIZE)) {
    const claimed = await store.claimPendingRecordings(batch);
    skipped += batch.length - claimed.length;
    if (claimed.length === 0) continue;

    try {
      await queue.sendBatch(
        claimed.map((recordingId) => ({
          body: {
            type: "process_recording",
            recordingId,
          },
        }))
      );
      queued += claimed.length;
    } catch (error) {
      await store.releasePendingRecordings(claimed);
      throw error;
    }
  }

  return {
    discovered: files.length,
    created,
    queued,
    skipped,
  };
}

function createDrizzleImportStore(db: Database): RecordingImportStore {
  return {
    async listKnownDriveRecordings() {
      const rows = await db
        .select({
          id: schema.recording.id,
          driveFileId: schema.recording.driveFileId,
          processingStatus: schema.recording.processingStatus,
        })
        .from(schema.recording)
        .where(isNotNull(schema.recording.driveFileId));

      return rows.map((row) => ({
        id: row.id,
        driveFileId: row.driveFileId as string,
        processingStatus: row.processingStatus,
      }));
    },

    async createPendingRecording(input) {
      const rows = await db
        .insert(schema.recording)
        .values({
          ...input,
          processingStatus: "pending",
        })
        .onConflictDoNothing({ target: schema.recording.driveFileId })
        .returning({
          id: schema.recording.id,
          driveFileId: schema.recording.driveFileId,
          processingStatus: schema.recording.processingStatus,
        });
      const row = rows[0];
      return row?.driveFileId
        ? {
            id: row.id,
            driveFileId: row.driveFileId,
            processingStatus: row.processingStatus,
          }
        : null;
    },

    async claimPendingRecordings(ids) {
      if (ids.length === 0) return [];
      const claimed = await db
        .update(schema.recording)
        .set({ processingStatus: "queued", processingError: null })
        .where(
          and(
            inArray(schema.recording.id, ids),
            eq(schema.recording.processingStatus, "pending")
          )
        )
        .returning({ id: schema.recording.id });
      return claimed.map(({ id }) => id);
    },

    async releasePendingRecordings(ids) {
      if (ids.length === 0) return;
      await db
        .update(schema.recording)
        .set({ processingStatus: "pending" })
        .where(
          and(
            inArray(schema.recording.id, ids),
            eq(schema.recording.processingStatus, "queued")
          )
        );
    },
  };
}

export async function syncRecordingImportSource(
  env: Env,
  sourceId: string
): Promise<RecordingImportSummary> {
  const db = drizzle(env.DB, { schema });
  const source = await db.query.recordingImportSource.findFirst({
    where: eq(schema.recordingImportSource.id, sourceId),
  });
  if (!source) {
    throw new Error(`Recording import source ${sourceId} was not found.`);
  }

  try {
    const cipher = createCredentialCipher(env);
    const credentials = await getGoogleDriveCredentials(db, cipher);
    if (!credentials) {
      throw new Error(
        "Google Drive credentials are not configured. Set them in Admin → Integrations."
      );
    }

    const files = await listGoogleDriveVideoFiles({
      credentials,
      folderId: source.driveFolderId,
      filenameContains: source.filenameContains,
    });
    const summary = await queueGoogleDriveFiles({
      files,
      source,
      store: createDrizzleImportStore(db),
      queue: env.RECORDING_QUEUE,
    });

    await db
      .update(schema.recordingImportSource)
      .set({ lastSyncedAt: new Date(), lastError: null })
      .where(eq(schema.recordingImportSource.id, source.id));

    return summary;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await db
      .update(schema.recordingImportSource)
      .set({ lastError: message })
      .where(eq(schema.recordingImportSource.id, source.id));
    throw error;
  }
}

export async function syncEnabledRecordingImportSources(
  env: Env
): Promise<RecordingImportSummary[]> {
  const db = drizzle(env.DB, { schema });

  if (!env.CREDENTIALS_ENCRYPTION_KEY) {
    console.log(JSON.stringify({ event: "drive_sync_skipped", reason: "no_encryption_key" }));
    return [];
  }

  let credentials;
  try {
    const cipher = createCredentialCipher(env);
    credentials = await getGoogleDriveCredentials(db, cipher);
  } catch (error) {
    console.log(JSON.stringify({
      event: "drive_sync_skipped",
      reason: "credential_error",
      message: error instanceof Error ? error.message : String(error),
    }));
    return [];
  }
  if (!credentials) {
    console.log(JSON.stringify({ event: "drive_sync_skipped", reason: "no_credentials" }));
    return [];
  }

  const sources = await db.query.recordingImportSource.findMany({
    where: eq(schema.recordingImportSource.enabled, true),
    orderBy: (source, { asc }) => [asc(source.createdAt)],
  });

  if (sources.length === 0) {
    return [];
  }

  const summaries: RecordingImportSummary[] = [];
  const failures: string[] = [];

  for (const source of sources) {
    try {
      summaries.push(await syncRecordingImportSource(env, source.id));
    } catch (error) {
      failures.push(
        `${source.name}: ${error instanceof Error ? error.message : String(error)}`
      );
    }
  }

  if (failures.length > 0) {
    throw new Error(`Google Drive import failed for ${failures.join("; ")}`);
  }
  return summaries;
}
