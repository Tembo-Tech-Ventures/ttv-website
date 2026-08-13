import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  deriveEnvironmentContext,
  findD1DatabaseByName,
  queryD1Database,
} from "./lib.mjs";

const RECORDING_ID_PATTERN = /^[a-z0-9]{20,32}$/;

export function parseRecordingDiagnosticsArgs(args) {
  const recordingIdArgument = args.find((argument) =>
    argument.startsWith("--recording-id=")
  );
  const recordingId = recordingIdArgument?.slice("--recording-id=".length).trim();
  if (!recordingId || !RECORDING_ID_PATTERN.test(recordingId)) {
    throw new Error(
      "Provide a valid --recording-id=<20-32 lowercase letters or numbers> argument."
    );
  }
  return { recordingId };
}

function firstResultRow(result) {
  const statements = Array.isArray(result) ? result : [result];
  return statements.flatMap((statement) => statement?.results ?? [])[0] ?? null;
}

export async function diagnoseRecording(
  { recordingId },
  {
    resolveContext = deriveEnvironmentContext,
    findDatabase = findD1DatabaseByName,
    executeQuery = queryD1Database,
  } = {}
) {
  const context = resolveContext();
  const database = await findDatabase(context.d1Name);
  if (!database?.uuid) {
    throw new Error(`D1 database ${context.d1Name} was not found.`);
  }

  const result = await executeQuery(
    database.uuid,
    `SELECT
       r."id",
       r."processingStatus",
       r."processingError",
       r."driveFileId" IS NOT NULL AS "hasDriveSource",
       r."r2VideoKey" IS NOT NULL AS "hasVideoObject",
       r."r2AudioKey" IS NOT NULL AS "hasAudioObject",
       r."durationSeconds",
       r."fileSizeBytes",
       r."createdAt",
       r."updatedAt",
       COUNT(ts."id") AS "segmentCount"
     FROM "recording" r
     LEFT JOIN "transcript_segment" ts ON ts."recordingId" = r."id"
     WHERE r."id" = ?
     GROUP BY r."id"
     LIMIT 1`,
    [recordingId]
  );
  const row = firstResultRow(result);
  if (!row) {
    throw new Error(`Recording ${recordingId} was not found in ${context.environmentName}.`);
  }

  return {
    environment: context.environmentName,
    recording: {
      id: row.id,
      processingStatus: row.processingStatus,
      processingError: row.processingError ?? null,
      hasDriveSource: Boolean(row.hasDriveSource),
      hasVideoObject: Boolean(row.hasVideoObject),
      hasAudioObject: Boolean(row.hasAudioObject),
      durationSeconds: row.durationSeconds ?? null,
      fileSizeBytes: row.fileSizeBytes ?? null,
      segmentCount: Number(row.segmentCount ?? 0),
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    },
  };
}

export async function main(args = process.argv.slice(2)) {
  const diagnostics = await diagnoseRecording(parseRecordingDiagnosticsArgs(args));
  console.log(JSON.stringify(diagnostics, null, 2));
}

const isDirectRun =
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (isDirectRun) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  });
}
