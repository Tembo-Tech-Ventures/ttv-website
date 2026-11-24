import type { Database, RECORDING_ACCESS_SCOPES } from "@/lib/db/schema";
import type { ChannelKind } from "@/lib/platform/contracts";
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
 * | DIRECT     | The two members of its conversation (`channelId`), and nobody else: admins neither |
 * | COMMUNITY  | Whoever can read its community channel (channelAccessFor): every signed-in person |
 * | ADMIN_ONLY | Admins                                                              |
 * | Deleted    | Nobody                                                              |
 * | Hidden     | Of those, only admins and the cohort's instructors and TAs          |
 *
 * A staging demo identity reaches only the demo cohort's recordings, whatever its roles. Every path
 * refuses in one way (the same 404), so nobody learns whether a recording they may not see exists.
 *
 * A path reads DIRECT and COMMUNITY recordings only when it asks to (`reach: "everything"`). The
 * session paths (the Sessions list and viewer, the video, search, Ask Tembo and Tembo, clips and
 * attention) read cohort sessions only, so a conversation's or an event's recording never reaches
 * search or Tembo, and a call's recording page opts in when a later slice builds it.
 *
 * The policy says who; what a reader gets of it depends on what exists: the video once it is stored
 * (`r2VideoKey`), the transcript once processing is complete (`transcriptReady`).
 */
export type RecordingViewer = Pick<PlatformCapabilities, "cohortIds" | "teachingCohortIds" | "isAdmin">
  /** Channels are read only by someone with the community space (channelAccessFor): without it, no channel's recording. */
  & Partial<Pick<PlatformCapabilities, "spaces">>;

/** The facts about a recording the policy reads. Timestamps may be Dates (Drizzle) or numbers (raw D1). */
export interface RecordingAccessTarget {
  programId: string | null;
  /** A RecordingAccessScope; raw D1 rows type it as text. Anything else admits nobody. */
  accessScope: string;
  deletedAt: Date | number | null;
  hiddenAt: Date | number | null;
  /** A DIRECT or COMMUNITY recording's channel. Left out, such a recording admits nobody. */
  channelId?: string | null;
}

export type RecordingAccessScope = (typeof RECORDING_ACCESS_SCOPES)[number];

/** Which recordings a path reads: cohort sessions only (the default), or every one the person may watch. */
export type RecordingReach = "sessions" | "everything";

/** The channel of a DIRECT or COMMUNITY recording, as its caller read it for the person asking. */
export interface RecordingChannel {
  id: string;
  kind: ChannelKind;
  /** Whether the person asking has an explicit channel_member row in it. */
  isMember: boolean;
}

export interface RecordingAccessContext {
  /** The person asking, for the demo rule and channels; null for a channel's audience (cohortAudience). */
  userId: string | null;
  /** Defaults to "sessions": DIRECT and COMMUNITY recordings admit nobody. */
  reach?: RecordingReach;
  /** The recording's channel, for reach "everything". Missing, or another channel, admits nobody. */
  channel?: RecordingChannel | null;
}

const DEMO_PROGRAM_ID = DEMO_PREFIX + "program";

/** Whether this viewer may watch the recording and read its transcript. */
export function recordingAccessFor(viewer: RecordingViewer, recording: RecordingAccessTarget, context: RecordingAccessContext): boolean {
  const { userId } = context;
  const { programId } = recording;
  if (recording.deletedAt !== null) return false;
  if (userId !== null && isDemoUser(userId) && programId !== DEMO_PROGRAM_ID) return false;
  if (recording.hiddenAt !== null && !viewer.isAdmin && !(programId !== null && viewer.teachingCohortIds.includes(programId))) return false;
  const channel = channelOf(viewer, recording, context);
  switch (recording.accessScope) {
    case "COHORT": return viewer.isAdmin || (programId !== null && viewer.cohortIds.includes(programId));
    case "ADMIN_ONLY": return viewer.isAdmin;
    // channelAccessFor's rule: a conversation's explicit members, admins no exception; a community
    // channel's every signed-in reader.
    case "DIRECT": return channel?.kind === "DIRECT" && channel.isMember;
    case "COMMUNITY": return channel?.kind === "COMMUNITY";
    default: return false;
  }
}

/** Whether this path, for this person, reads channels' recordings at all: everything, asked by someone who can read channels. */
const readsChannels = (viewer: RecordingViewer, userId: string | null, reach: RecordingReach = "sessions") =>
  reach === "everything" && userId !== null && viewer.spaces?.includes("community") === true;

/** The recording's channel, when this path reads channels' recordings and the caller read that very channel. */
function channelOf(viewer: RecordingViewer, recording: RecordingAccessTarget, { userId, reach, channel }: RecordingAccessContext) {
  if (!readsChannels(viewer, userId, reach) || !channel || !recording.channelId) return null;
  return channel.id === recording.channelId ? channel : null;
}

/**
 * The same rule as a SQL condition on the recording table under `alias`, for a WHERE clause. The
 * viewer's cohorts are written into the statement as string literals, so the condition carries no
 * parameters and fits any statement, Drizzle's (through `sql.raw`) or a prepared one with numbered
 * parameters.
 */
export function recordingScopeSql(
  viewer: RecordingViewer, userId: string | null, alias = "recording", { reach = "sessions" }: { reach?: RecordingReach } = {},
): string {
  const column = (name: string) => `${alias}.${name}`;
  const programId = column("programId");
  const sessions = viewer.isAdmin
    ? `${column("accessScope")} IN ('COHORT', 'ADMIN_ONLY')`
    : `(${column("accessScope")} = 'COHORT' AND ${inList(programId, viewer.cohortIds)})`;
  const scopes = userId !== null && readsChannels(viewer, userId, reach) ? `(${sessions} OR ${channelScopesSql(column, userId)})` : sessions;
  const hidden = viewer.isAdmin ? "" : ` AND (${column("hiddenAt")} IS NULL OR ${inList(programId, viewer.teachingCohortIds)})`;
  const demo = userId !== null && isDemoUser(userId) ? ` AND ${programId} = ${literal(DEMO_PROGRAM_ID)}` : "";
  return `(${column("deletedAt")} IS NULL AND ${scopes}${hidden}${demo})`;
}

/** recordingAccessFor's DIRECT and COMMUNITY rule for one signed-in person, over the recording's channelId. */
function channelScopesSql(column: (name: string) => string, userId: string): string {
  const channel = column("channelId");
  return `(${column("accessScope")} = 'DIRECT' AND EXISTS (SELECT 1 FROM channel_member recording_member
      JOIN channel recording_channel ON recording_channel.id = recording_member.channelId
      WHERE recording_member.channelId = ${channel} AND recording_member.userId = ${literal(userId)} AND recording_channel.kind = 'DIRECT'))
    OR (${column("accessScope")} = 'COMMUNITY' AND EXISTS (SELECT 1 FROM channel recording_channel
      WHERE recording_channel.id = ${channel} AND recording_channel.kind = 'COMMUNITY'))`;
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

/**
 * The scope a recording placed in a cohort, or in none, takes: that cohort's, or admins only. Every
 * insert names its scope with this (migration 0043 no longer infers one for this Worker's rows).
 */
export const cohortScope = (programId: string | null): Extract<RecordingAccessScope, "COHORT" | "ADMIN_ONLY"> =>
  (programId === null ? "ADMIN_ONLY" : "COHORT");

/** Whether the policy can admit this viewer to any cohort session at all: otherwise no session read is worth making. */
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
