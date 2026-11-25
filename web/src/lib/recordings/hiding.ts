import { touchMessagesShowing } from "@/lib/channels/mutations";
import { touchRecordingCard } from "@/lib/meetings/card-state";
import type { RecordingAccessTarget, RecordingViewer } from "./access";

/**
 * Hiding a cohort recording from its cohort (in-app calls P9, UX review M9; README.md beside this
 * file, "Hiding a recording"). Cohort sessions are recorded with no pause and reach the cohort as
 * soon as they're processed, so the cohort's hosts (its instructors and TAs) and admins can take one
 * down and put it back. Hidden, the recording access policy (access.ts) lets only admins and the
 * cohort's hosts watch it or read its transcript, on every path; everyone else gets the same 404.
 */

/** Whether this person may hide or show this recording: a cohort's own, not deleted, and they host that cohort or are an admin. */
export function mayHideRecording(viewer: RecordingViewer, recording: Pick<RecordingAccessTarget, "programId" | "accessScope" | "deletedAt">): boolean {
  if (recording.accessScope !== "COHORT" || recording.deletedAt !== null || recording.programId === null) return false;
  return viewer.isAdmin || viewer.teachingCohortIds.includes(recording.programId);
}

/**
 * Hides a cohort recording from its cohort (`hidden`), or shows it again. Saying the same twice
 * changes nothing. The write re-checks that it is still a cohort's recording and not deleted, so a
 * stale page can't hide something that has since changed; the caller has checked mayHideRecording.
 * The card of the session it came from, and Tembo's answers that cite it (withheld while it is
 * hidden), change with it in every open channel page. Returns whether the recording is now as asked.
 */
export async function setRecordingHidden(db: D1Database, recordingId: string, hidden: boolean, now: number): Promise<boolean> {
  const eligible = "id = ?1 AND accessScope = 'COHORT' AND deletedAt IS NULL AND programId IS NOT NULL";
  // hiddenAt and updatedAt are whole seconds, as Drizzle's timestamp columns store them. Only a change writes.
  const changed = await db.prepare(`UPDATE recording SET hiddenAt = CASE WHEN ?2 THEN ?3 END, updatedAt = ?3
    WHERE ${eligible} AND (hiddenAt IS NULL) = ?2 RETURNING id`).bind(recordingId, hidden ? 1 : 0, Math.floor(now / 1000)).first();
  if (changed === null) {
    // Already as asked (a second press), or no longer a cohort's recording to hide.
    return await db.prepare(`SELECT 1 FROM recording WHERE ${eligible} AND (hiddenAt IS NOT NULL) = ?2`).bind(recordingId, hidden ? 1 : 0).first() !== null;
  }
  await touchRecordingCard(db, recordingId);
  await touchMessagesShowing(db, recordingId);
  return true;
}
