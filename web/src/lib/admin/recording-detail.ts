import { and, count, eq } from "drizzle-orm";
import * as schema from "@/lib/db/schema";
import type { Database } from "@/lib/db/schema";
import { cohortScope } from "@/lib/recordings/access";

/*
 * One recording for the admin: its details, its processing, and its transcript.
 * The page edits the details and the transcript, and queues the recording to be
 * transcribed again or its search entries rebuilt. Every change answers with
 * what went wrong in words; nothing here throws for a bad value.
 */

export type ProcessingStatus = (typeof schema.recording.$inferSelect)["processingStatus"];

export const PROCESSING_STATUSES = schema.recording.processingStatus.enumValues;

export const isProcessingStatus = (value: unknown): value is ProcessingStatus =>
  typeof value === "string" && (PROCESSING_STATUSES as readonly string[]).includes(value);

/** The recording, how many timed segments its transcript has, and the cohorts it may belong to, in one round trip. */
export async function readRecordingDetail(db: Database, id: string) {
  const [recording, [{ segments }], programs] = await Promise.all([
    db.query.recording.findFirst({ where: eq(schema.recording.id, id) }),
    db.select({ segments: count() }).from(schema.transcriptSegment).where(eq(schema.transcriptSegment.recordingId, id)),
    db.query.program.findMany({ columns: { id: true, name: true }, orderBy: (program, { asc }) => [asc(program.name)] }),
  ]);
  return recording ? { recording, segments, programs } : null;
}

export const TITLE_MAX = 200;

export type DetailsValues = { title: string; programId: string; recordedAt: string; description: string };
export type DetailsErrors = Partial<Record<keyof DetailsValues, string>>;
export type TranscriptValues = { transcriptText: string; transcriptVtt: string };
export type TranscriptErrors = Partial<Record<keyof TranscriptValues, string>>;

const text = (formData: FormData, name: string) => {
  const value = formData.get(name);
  return typeof value === "string" ? value : "";
};

const nairobiDay = new Intl.DateTimeFormat("en-CA", { year: "numeric", month: "2-digit", day: "2-digit", timeZone: "Africa/Nairobi" });

/** A recorded moment as a date field's value, on the day the page shows it (Nairobi time). */
export function recordedAtField(date: Date | null): string {
  return date ? nairobiDay.format(date) : "";
}

/** The details form as the admin filled it in, and what is wrong with it. */
export function detailsFromForm(formData: FormData, programIds: readonly string[]): { values: DetailsValues; errors: DetailsErrors } {
  const values: DetailsValues = {
    title: text(formData, "title").trim(),
    programId: text(formData, "programId"),
    recordedAt: text(formData, "recordedAt").trim(),
    description: text(formData, "description").trim(),
  };
  const errors: DetailsErrors = {};
  if (!values.title) errors.title = "Give the recording a title.";
  else if (values.title.length > TITLE_MAX) errors.title = `Keep the title to ${TITLE_MAX} characters.`;
  if (values.programId && !programIds.includes(values.programId)) errors.programId = "Choose a cohort from the list, or no cohort.";
  if (values.recordedAt && !parseDay(values.recordedAt)) errors.recordedAt = "Write the date as a day, month and year.";
  return { values, errors };
}

/** A `YYYY-MM-DD` that names a real day, as midnight UTC; anything else is null. */
function parseDay(value: string): Date | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const date = new Date(`${value}T00:00:00Z`);
  return Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== value ? null : date;
}

/** What a new upload is before its details: no cohort, admins only, a scope this Worker chose. */
export const NEW_UPLOAD = { recordedAt: null, programId: null, accessScope: "ADMIN_ONLY", scopeChosen: true } as const;

/** What detailsUpdate reads of the recording as it is. scopeChosen is null on a row no Worker since migration 0043 has scoped. */
export type DetailsCurrent = { recordedAt: Date | null; programId: string | null; accessScope: string; scopeChosen: boolean | null };

/**
 * The row to write for valid details. A date the admin left as it was keeps the
 * moment it was recorded (an import knows the time, the field only the day).
 * Choosing a cohort for a recording that had none makes it that cohort's, as the
 * admin asked; a cohort's recording moves with its cohort, or becomes admins only
 * with none. The database no longer widens anything itself (migration 0043). A
 * recording this Worker kept admins only within a cohort stays so, and a
 * conversation's or the community's recording keeps its own scope.
 *
 * One row is put right on any save, even with nothing changed: admins only within
 * a cohort, with no scope chosen. Only a Worker from before 0043 giving a recording
 * a cohort while 0043 was applied (the deploy window, or a rollback) leaves one, since
 * its page relied on 0042's widening trigger. Every scope this writes is chosen.
 */
export function detailsUpdate(values: DetailsValues, current: DetailsCurrent) {
  const unchanged = values.recordedAt === recordedAtField(current.recordedAt);
  const programId = values.programId || null;
  const moved = programId !== current.programId
    && (current.accessScope === "COHORT" || (current.accessScope === "ADMIN_ONLY" && current.programId === null));
  const stranded = current.scopeChosen === null && current.accessScope === "ADMIN_ONLY" && current.programId !== null;
  return {
    title: values.title,
    description: values.description || null,
    programId,
    recordedAt: unchanged ? current.recordedAt : parseDay(values.recordedAt),
    ...(moved || stranded ? { accessScope: cohortScope(programId), scopeChosen: true } : {}),
  };
}

/** The transcript form as the admin filled it in, and what is wrong with it. */
export function transcriptFromForm(formData: FormData): { values: TranscriptValues; errors: TranscriptErrors } {
  const values: TranscriptValues = { transcriptText: text(formData, "transcriptText"), transcriptVtt: text(formData, "transcriptVtt") };
  const errors: TranscriptErrors = {};
  // A WebVTT file starts with the line "WEBVTT" (after an optional byte-order mark).
  if (values.transcriptVtt.trim() && !/^﻿?WEBVTT(?:[ \t]|\r?\n|$)/.test(values.transcriptVtt.trimStart())) {
    errors.transcriptVtt = "Captions in WebVTT start with the line WEBVTT. Paste the whole file, or leave this empty.";
  }
  return { values, errors };
}

/** The recording's queue: the one binding the page needs from the Worker's environment. */
export type RecordingQueue = { send(message: { type: "process_recording" | "reindex_recording"; recordingId: string }): Promise<unknown> };

export type QueueResult = { ok: true } | { ok: false; reason: "missing" | "changed" };

/**
 * Queues the recording to be transcribed again, only from the status the page
 * showed, so two admins (or an admin and a running job) can't both restart it.
 * If the queue refuses the message, the status goes back to what it was and the
 * error is the caller's to say.
 */
export async function transcribeAgain(db: Database, queue: RecordingQueue, id: string, expected: ProcessingStatus): Promise<QueueResult> {
  const current = await db.query.recording.findFirst({
    where: eq(schema.recording.id, id),
    columns: { processingStatus: true, processingError: true },
  });
  if (!current) return { ok: false, reason: "missing" };
  if (current.processingStatus !== expected) return { ok: false, reason: "changed" };
  const claimed = await db
    .update(schema.recording)
    .set({ processingStatus: "queued", processingError: null })
    .where(and(eq(schema.recording.id, id), eq(schema.recording.processingStatus, expected)))
    .returning({ id: schema.recording.id });
  if (claimed.length === 0) return { ok: false, reason: "changed" };
  try {
    await queue.send({ type: "process_recording", recordingId: id });
  } catch (error) {
    await db
      .update(schema.recording)
      .set({ processingStatus: expected, processingError: current.processingError })
      .where(and(eq(schema.recording.id, id), eq(schema.recording.processingStatus, "queued")));
    throw error;
  }
  return { ok: true };
}
