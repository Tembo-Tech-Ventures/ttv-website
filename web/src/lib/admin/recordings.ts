import { asc, count, desc, eq } from "drizzle-orm";
import * as schema from "@/lib/db/schema";
import type { Database } from "@/lib/db/schema";
import { ADMIN_PAGE_SIZE } from "@/lib/admin/paging";

/*
 * The admin's list of session recordings: newest first, a page at a time,
 * each with the cohort it belongs to, read with the total in one round trip.
 */

export const RECORDINGS_PATH = "/admin/recordings";

/** One page of recordings with their cohort's name, and how many there are. */
export async function readRecordingsPage(db: Database, { page }: { page: number }) {
  const recording = schema.recording;
  const [rows, [{ total }]] = await Promise.all([
    db
      .select({
        id: recording.id,
        title: recording.title,
        cohort: schema.program.name,
        recordedAt: recording.recordedAt,
        durationSeconds: recording.durationSeconds,
        processingStatus: recording.processingStatus,
      })
      .from(recording)
      .leftJoin(schema.program, eq(schema.program.id, recording.programId))
      .orderBy(desc(recording.createdAt), asc(recording.id))
      .limit(ADMIN_PAGE_SIZE)
      .offset((page - 1) * ADMIN_PAGE_SIZE),
    db.select({ total: count() }).from(recording),
  ]);
  return { rows, total };
}
