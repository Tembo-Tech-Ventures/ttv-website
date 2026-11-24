import type { Database } from "@/lib/db/schema";
import { capabilitiesFor, type PlatformCapabilities } from "@/lib/platform/server/capabilities";
import { DEMO_PREFIX, isDemoUser } from "@/lib/staging-demo-policy";

export { COHORT_ACCESS_STATUSES } from "@/lib/platform/server/capabilities";

/**
 * Who may watch a recording and read its transcript: one rule for every path that reads one (the
 * Sessions list and viewer, the video, search, Ask Tembo and its tools, Tembo in channels, clips,
 * attention). It has two forms that access.test.ts proves equal: `recordingAccessFor` for one
 * recording, and `recordingScopeSql`, the same rule as a SQL condition, for lists and search.
 *
 * | Scope      | Who                                                                 |
 * |------------|---------------------------------------------------------------------|
 * | COHORT     | People whose cohorts include it (capabilitiesFor's cohortIds), and admins |
 * | DIRECT     | The conversation's two members. Nobody yet: no recording has a conversation before migration 0043 |
 * | COMMUNITY  | The channel's readers. Nobody yet, for the same reason                |
 * | ADMIN_ONLY | Admins                                                              |
 * | Deleted    | Nobody                                                              |
 * | Hidden     | Of those, only admins and the cohort's instructors and TAs          |
 *
 * A staging demo identity reaches only the demo cohort's recordings, whatever its roles. Every path
 * refuses in one way (the same 404), so nobody learns whether a recording they may not see exists.
 *
 * The policy says who; what a reader gets of it depends on what exists: the video once it is stored
 * (`r2VideoKey`), the transcript once processing is complete (`transcriptReady`).
 */
export type RecordingViewer = Pick<PlatformCapabilities, "cohortIds" | "teachingCohortIds" | "isAdmin">;

/** The facts about a recording the policy reads. Timestamps may be Dates (Drizzle) or numbers (raw D1). */
export interface RecordingAccessTarget {
  programId: string | null;
  /** A RecordingAccessScope; raw D1 rows type it as text. Anything else admits nobody. */
  accessScope: string;
  deletedAt: Date | number | null;
  hiddenAt: Date | number | null;
}

export interface RecordingAccessContext {
  /** The person asking, for the demo rule; null for a channel's audience (cohortAudience). */
  userId: string | null;
}

const DEMO_PROGRAM_ID = DEMO_PREFIX + "program";

/** Whether this viewer may watch the recording and read its transcript. */
export function recordingAccessFor(viewer: RecordingViewer, recording: RecordingAccessTarget, { userId }: RecordingAccessContext): boolean {
  const { programId } = recording;
  if (recording.deletedAt !== null) return false;
  if (userId !== null && isDemoUser(userId) && programId !== DEMO_PROGRAM_ID) return false;
  if (recording.hiddenAt !== null && !viewer.isAdmin && !(programId !== null && viewer.teachingCohortIds.includes(programId))) return false;
  switch (recording.accessScope) {
    case "COHORT": return viewer.isAdmin || (programId !== null && viewer.cohortIds.includes(programId));
    case "ADMIN_ONLY": return viewer.isAdmin;
    default: return false;
  }
}

/**
 * The same rule as a SQL condition on the recording table under `alias`, for a WHERE clause. The
 * viewer's cohorts are written into the statement as string literals, so the condition carries no
 * parameters and fits any statement, Drizzle's (through `sql.raw`) or a prepared one with numbered
 * parameters.
 */
export function recordingScopeSql(viewer: RecordingViewer, userId: string | null, alias = "recording"): string {
  const column = (name: string) => `${alias}.${name}`;
  const programId = column("programId");
  const scopes = viewer.isAdmin
    ? `${column("accessScope")} IN ('COHORT', 'ADMIN_ONLY')`
    : `(${column("accessScope")} = 'COHORT' AND ${inList(programId, viewer.cohortIds)})`;
  const hidden = viewer.isAdmin ? "" : ` AND (${column("hiddenAt")} IS NULL OR ${inList(programId, viewer.teachingCohortIds)})`;
  const demo = userId !== null && isDemoUser(userId) ? ` AND ${programId} = ${literal(DEMO_PROGRAM_ID)}` : "";
  return `(${column("deletedAt")} IS NULL AND ${scopes}${hidden}${demo})`;
}

/**
 * Everyone who reads a cohort channel: what they all may see is what a member of that cohort without
 * any other role may. Tembo's answers, clips and the "ready to watch" notice reach the whole channel
 * or cohort, so they read recordings as this viewer, never as the person asking.
 */
export function cohortAudience(programId: string): RecordingViewer {
  return { cohortIds: [programId], teachingCohortIds: [], isAdmin: false };
}

/**
 * recordingScopeSql for `cohortAudience`, where the cohort is a SQL expression (a statement's
 * parameter, or a column) rather than a value: the recording is its cohort's, neither deleted nor
 * hidden. access.test.ts proves the two equal.
 */
export function cohortAudienceSql(alias: string, programId: string): string {
  return `(${alias}.deletedAt IS NULL AND ${alias}.accessScope = 'COHORT' AND ${alias}.programId = ${programId} AND ${alias}.hiddenAt IS NULL)`;
}

/** Whether the policy can admit this viewer to any recording at all: otherwise no recording read is worth making. */
export function mayReadRecordings(viewer: RecordingViewer): boolean {
  return viewer.isAdmin || viewer.cohortIds.length > 0;
}

/** The transcript is readable once processing is complete; the video as soon as it is stored. */
export const transcriptReady = (recording: { processingStatus: string }) => recording.processingStatus === "complete";
export const transcriptReadySql = (alias = "recording") => `${alias}.processingStatus = 'complete'`;

/** Readable cohorts for cohort features other than recordings (the student journey's cohort access). */
export async function getAccessibleProgramIds(db: Database, userId: string) {
  return (await capabilitiesFor(db, { id: userId })).cohortIds;
}

/** A SQL string literal. SQLite has no backslash escapes; a NUL would end the statement's text early. */
function literal(value: string): string {
  if (value.includes("\0")) throw new Error("A recording access value cannot contain NUL.");
  return `'${value.replaceAll("'", "''")}'`;
}
const inList = (expression: string, values: readonly string[]) =>
  values.length === 0 ? "0" : `${expression} IN (${values.map(literal).join(", ")})`;
