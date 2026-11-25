import { recordingScopeSql, transcriptReadySql, type RecordingViewer } from "@/lib/recordings/access";
import type { TranscriptSource } from "./tools";

/**
 * Ask Tembo's saved answers are copies of transcript words (lib/recordings/README.md, "Stored copies
 * of transcript text"). Each one is checked again whenever it is read: an answer that drew on a
 * recording its owner may no longer read (hidden, deleted, moved out of their cohort, or no longer
 * complete) is replaced by WITHHELD_ANSWER, and that recording's citations are dropped.
 *
 * What an answer drew on is in `chat_message.citations`, a JSON array: the citations the reader sees
 * (one per transcript range, from search_transcripts), then one trace entry `{ type: "read",
 * recordingId }` for every recording whose transcript a tool read (search_transcripts or
 * get_recording_details), cited or not. Trace entries are only for this check and never leave the
 * server. Answers saved before the traces existed carry only their citations, so a transcript such an
 * answer read through get_recording_details without citing it can't be traced.
 */

/** What an answer that drew on a session its reader can no longer see says instead. */
export const WITHHELD_ANSWER = "This answer used a session you can no longer see, so it isn't shown.";

/** A trace entry: a recording whose transcript a tool read for this answer. */
export interface ReadTrace { type: "read"; recordingId: string }

const isTrace = (entry: unknown): entry is ReadTrace =>
  typeof entry === "object" && entry !== null && (entry as { type?: unknown }).type === "read";

const recordingOf = (entry: unknown): string | null => {
  const id = typeof entry === "object" && entry !== null ? (entry as { recordingId?: unknown }).recordingId : null;
  return typeof id === "string" && id !== "" ? id : null;
};

/**
 * The citations to store with an answer: what the reader is shown, then a trace of every recording
 * whose transcript the tools read (its sources' recordings included).
 */
export function storedCitations(citations: readonly unknown[], sources: readonly TranscriptSource[], read: Iterable<string>): unknown[] {
  const recordings = new Set([...sources.map(({ recordingId }) => recordingId), ...read]);
  return [...citations, ...[...recordings].map((recordingId): ReadTrace => ({ type: "read", recordingId }))];
}

/**
 * A SQL expression over a saved message's `citations` column: a JSON array of the recordings it names
 * (a citation's or a trace's) that `viewer` may no longer read, '[]' when none. One correlated
 * subquery on recording's primary key per named recording, inside the statement that reads the message.
 */
export function goneRecordingsSql(viewer: RecordingViewer, userId: string, citations: string): string {
  return `(SELECT json_group_array(named.recordingId) FROM (SELECT DISTINCT json_extract(entry.value, '$.recordingId') AS recordingId
      FROM json_each(CASE WHEN json_valid(${citations}) THEN ${citations} ELSE '[]' END) entry
      WHERE json_type(entry.value, '$.recordingId') = 'text') named
    WHERE NOT EXISTS (SELECT 1 FROM recording stored_recording WHERE stored_recording.id = named.recordingId
      AND ${recordingScopeSql(viewer, userId, "stored_recording")} AND ${transcriptReadySql("stored_recording")}))`;
}

/** The recording ids of goneRecordingsSql's column. */
export function goneRecordings(column: unknown): Set<string> {
  if (typeof column !== "string" || column === "") return new Set();
  try {
    const value: unknown = JSON.parse(column);
    return new Set(Array.isArray(value) ? value.filter((id): id is string => typeof id === "string") : []);
  } catch { return new Set(); }
}

/**
 * A saved message as its owner may read it now: trace entries stripped; when it drew on a recording
 * in `gone`, its text withheld and that recording's citations dropped. A person's own question is
 * never withheld: it names no recording.
 */
export function messageForReader<T extends { role: string; content: string; citations: unknown[] }>(message: T, gone: ReadonlySet<string>): T {
  const citations = message.citations.filter((entry) => !isTrace(entry));
  if (gone.size === 0 || message.role !== "assistant") return { ...message, citations };
  const drew = message.citations.some((entry) => {
    const id = recordingOf(entry);
    return id !== null && gone.has(id);
  });
  if (!drew) return { ...message, citations };
  return {
    ...message,
    content: WITHHELD_ANSWER,
    citations: citations.filter((entry) => { const id = recordingOf(entry); return id === null || !gone.has(id); }),
  };
}
