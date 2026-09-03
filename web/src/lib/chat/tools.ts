import { and, asc, desc, eq, inArray } from "drizzle-orm";
import * as schema from "@/lib/db/schema";
import type { Database } from "@/lib/db/schema";
import type { ToolDefinition } from "@/lib/ai/gateway";
import { formatTimestamp, formatDuration } from "@/lib/recordings/time-utils";

export interface TranscriptSource {
  sourceNumber: number;
  recordingId: string;
  title: string;
  startTime: number;
  endTime: number;
  text: string;
}

export interface ToolContext {
  env: Env;
  db: Database;
  userId: string;
  userName: string;
  programIds: string[];
  isAdmin: boolean;
  /** Accumulates sources across tool calls for citation building. */
  sources: TranscriptSource[];
}

export const TOOL_DEFINITIONS: ToolDefinition[] = [
  {
    type: "function",
    function: {
      name: "search_transcripts",
      description:
        "Search through session recording transcripts for specific topics, discussions, or advice. Returns relevant excerpts with timestamps. Call multiple times with different queries to broaden coverage.",
      parameters: {
        type: "object",
        properties: {
          query: { type: "string", description: "What to search for" },
        },
        required: ["query"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "get_user_context",
      description:
        "Get the current user's profile: enrolled programs, role (student, instructor, or TA), application status, and cohort dates. Call this when you need to personalize your answer or when the user asks about their own status.",
      parameters: { type: "object", properties: {} },
    },
  },
  {
    type: "function",
    function: {
      name: "list_recordings",
      description:
        "List available session recordings. Returns titles, dates, and durations.",
      parameters: {
        type: "object",
        properties: {
          limit: { type: "number", description: "Max results (default 10)" },
        },
      },
    },
  },
  {
    type: "function",
    function: {
      name: "get_recording_details",
      description:
        "Get details about a specific recording: title, date, duration, and the full transcript. Use for questions about an entire session.",
      parameters: {
        type: "object",
        properties: {
          recording_id: { type: "string", description: "The recording ID" },
        },
        required: ["recording_id"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "get_program_info",
      description:
        "Get details about a training program: name, description, dates, curriculum, and instructors. If no program_id is given, returns info for the user's enrolled program(s).",
      parameters: {
        type: "object",
        properties: {
          program_id: { type: "string", description: "Optional program ID" },
        },
      },
    },
  },
];

export async function executeTool(
  toolName: string,
  args: Record<string, unknown>,
  ctx: ToolContext
): Promise<string> {
  switch (toolName) {
    case "search_transcripts":
      return searchTranscripts(String(args.query ?? ""), ctx);
    case "get_user_context":
      return getUserContext(ctx);
    case "list_recordings":
      return listRecordings(Number(args.limit) || 10, ctx);
    case "get_recording_details":
      return getRecordingDetails(String(args.recording_id ?? ""), ctx);
    case "get_program_info":
      return getProgramInfo(args.program_id ? String(args.program_id) : null, ctx);
    default:
      return JSON.stringify({ error: `Unknown tool: ${toolName}` });
  }
}

interface ParsedMatch {
  segmentId: string | null;
  recordingId: string | null;
  startTime: number | null;
  endTime: number | null;
}

interface SegmentRow {
  id: string;
  recordingId: string;
  startTime: number;
  endTime: number;
  text: string;
  recordingTitle: string;
  recordingProgramId: string | null;
}

function buildAccessFilter(
  isAdmin: boolean,
  recordingIds: string[],
  segmentIds: string[],
  programIds: string[]
) {
  const idFilter =
    recordingIds.length > 0
      ? inArray(schema.recording.id, recordingIds)
      : inArray(schema.transcriptSegment.id, segmentIds);
  if (isAdmin) return idFilter;
  return and(idFilter, inArray(schema.recording.programId, programIds));
}

function deduplicateMatches(
  matches: ParsedMatch[],
  segmentRows: SegmentRow[],
  baseSourceNumber: number
): TranscriptSource[] {
  const rowsByRecordingId = new Map<string, SegmentRow[]>();
  for (const row of segmentRows) {
    const existing = rowsByRecordingId.get(row.recordingId) ?? [];
    existing.push(row);
    rowsByRecordingId.set(row.recordingId, existing);
  }

  const seenRanges = new Set<string>();
  const sources: TranscriptSource[] = [];

  for (const match of matches) {
    const rows = match.recordingId ? rowsByRecordingId.get(match.recordingId) ?? [] : segmentRows;
    const matched =
      match.startTime !== null && match.endTime !== null
        ? rows.filter((r) => r.startTime < match.endTime! + 0.5 && r.endTime > match.startTime! - 0.5)
        : rows.filter((r) => r.id === match.segmentId);

    if (matched.length === 0) continue;

    const first = matched[0];
    const last = matched.at(-1) ?? first;
    const dedup = `${first.recordingId}:${Math.floor(first.startTime)}:${Math.floor(last.endTime)}`;
    if (seenRanges.has(dedup)) continue;
    seenRanges.add(dedup);

    sources.push({
      sourceNumber: baseSourceNumber + sources.length + 1,
      recordingId: first.recordingId,
      title: first.recordingTitle,
      startTime: first.startTime,
      endTime: last.endTime,
      text: matched.map((r) => r.text).join(" "),
    });

    if (sources.length >= 8) break;
  }

  return sources;
}

async function searchTranscripts(query: string, ctx: ToolContext): Promise<string> {
  if (!query.trim()) return JSON.stringify({ results: [], note: "Empty query" });

  if (ctx.programIds.length === 0 && !ctx.isAdmin) {
    return JSON.stringify({ results: [], note: "No recordings available for this user" });
  }

  const embedding = (await ctx.env.AI.run("@cf/baai/bge-m3", {
    text: [query],
  })) as { data?: number[][]; result?: { data?: number[][] } };
  const vector = embedding.data?.[0] ?? embedding.result?.data?.[0];
  if (!Array.isArray(vector)) {
    return JSON.stringify({ error: "Unable to embed query" });
  }

  const results = await ctx.env.VECTORIZE.query(vector, { topK: 50, returnMetadata: "all" });

  interface MatchMeta { segment_id?: unknown; recording_id?: unknown; start_time?: unknown; end_time?: unknown }

  const matches: ParsedMatch[] = results.matches
    .map((match) => {
      const m = (match.metadata ?? {}) as MatchMeta;
      return { segmentId: strMeta(m.segment_id), recordingId: strMeta(m.recording_id), startTime: numMeta(m.start_time), endTime: numMeta(m.end_time) };
    })
    .filter((m) => m.segmentId || m.recordingId);

  const segmentIds = matches.map((m) => m.segmentId).filter((id): id is string => Boolean(id));
  const recordingIds = Array.from(new Set(matches.map((m) => m.recordingId).filter((id): id is string => Boolean(id))));

  if (segmentIds.length === 0 && recordingIds.length === 0) {
    return JSON.stringify({ results: [], note: "No matching segments" });
  }

  const segmentRows = (await ctx.db
    .select({
      id: schema.transcriptSegment.id, recordingId: schema.transcriptSegment.recordingId,
      startTime: schema.transcriptSegment.startTime, endTime: schema.transcriptSegment.endTime,
      text: schema.transcriptSegment.text, recordingTitle: schema.recording.title,
      recordingProgramId: schema.recording.programId,
    })
    .from(schema.transcriptSegment)
    .innerJoin(schema.recording, eq(schema.transcriptSegment.recordingId, schema.recording.id))
    .where(buildAccessFilter(ctx.isAdmin, recordingIds, segmentIds, ctx.programIds))
    .orderBy(asc(schema.transcriptSegment.startTime))) as SegmentRow[];

  const newSources = deduplicateMatches(matches, segmentRows, ctx.sources.length);
  ctx.sources.push(...newSources);

  return JSON.stringify({
    results: newSources.map((s) => ({
      sourceNumber: s.sourceNumber,
      title: s.title,
      timecode: `${formatTimestamp(s.startTime)}-${formatTimestamp(s.endTime)}`,
      videoLink: `/dashboard/sessions/${s.recordingId}?t=${Math.floor(s.startTime)}`,
      transcript: s.text,
    })),
  });
}

async function getUserContext(ctx: ToolContext): Promise<string> {
  const applications = await ctx.db.query.programApplication.findMany({
    where: eq(schema.programApplication.userId, ctx.userId),
    with: { program: { with: { curriculum: true } } },
  });

  const staffRoles = await ctx.db.query.programRole.findMany({
    where: eq(schema.programRole.userId, ctx.userId),
    with: { program: true },
  });

  return JSON.stringify({
    name: ctx.userName,
    isAdmin: ctx.isAdmin,
    applications: applications.map((a) => ({
      status: a.status,
      programName: a.program?.name ?? null,
      programDescription: a.program?.description ?? null,
      startDate: a.program?.startDate ? new Date(a.program.startDate).toISOString().slice(0, 10) : null,
      endDate: a.program?.endDate ? new Date(a.program.endDate).toISOString().slice(0, 10) : null,
      curriculum: a.program?.curriculum?.title ?? null,
      completedAt: a.completedAt ? new Date(a.completedAt).toISOString().slice(0, 10) : null,
    })),
    staffRoles: staffRoles.map((r) => ({
      role: r.name,
      programName: r.program?.name ?? null,
    })),
  });
}

async function listRecordings(limit: number, ctx: ToolContext): Promise<string> {
  const cap = Math.min(Math.max(limit, 1), 25);

  const where =
    ctx.isAdmin || ctx.programIds.length === 0
      ? eq(schema.recording.processingStatus, "complete")
      : and(
          eq(schema.recording.processingStatus, "complete"),
          inArray(schema.recording.programId, ctx.programIds)
        );

  const recordings = await ctx.db
    .select({
      id: schema.recording.id,
      title: schema.recording.title,
      durationSeconds: schema.recording.durationSeconds,
      recordedAt: schema.recording.recordedAt,
      programId: schema.recording.programId,
    })
    .from(schema.recording)
    .where(where)
    .orderBy(desc(schema.recording.recordedAt))
    .limit(cap);

  return JSON.stringify({
    recordings: recordings.map((r) => ({
      id: r.id,
      title: r.title,
      duration: formatDuration(r.durationSeconds),
      recordedAt: r.recordedAt ? new Date(r.recordedAt).toISOString().slice(0, 10) : null,
    })),
  });
}

async function getRecordingDetails(recordingId: string, ctx: ToolContext): Promise<string> {
  if (!recordingId) return JSON.stringify({ error: "recording_id is required" });

  const rec = await ctx.db.query.recording.findFirst({
    where: eq(schema.recording.id, recordingId),
  });
  if (!rec) return JSON.stringify({ error: "Recording not found" });

  if (!ctx.isAdmin && rec.programId && !ctx.programIds.includes(rec.programId)) {
    return JSON.stringify({ error: "You do not have access to this recording" });
  }

  const transcript = rec.transcriptText
    ? rec.transcriptText.length > 12_000
      ? `${rec.transcriptText.slice(0, 12_000)}… [truncated]`
      : rec.transcriptText
    : null;

  return JSON.stringify({
    id: rec.id,
    title: rec.title,
    description: rec.description,
    duration: formatDuration(rec.durationSeconds),
    recordedAt: rec.recordedAt ? new Date(rec.recordedAt).toISOString().slice(0, 10) : null,
    transcript,
  });
}

async function getProgramInfo(
  programId: string | null,
  ctx: ToolContext
): Promise<string> {
  const targetIds = programId ? [programId] : ctx.programIds;

  if (targetIds.length === 0) {
    const allPrograms = await ctx.db.query.program.findMany({
      with: { curriculum: true },
    });
    return JSON.stringify({
      note: "You are not enrolled in any programs. Here are the available programs:",
      programs: allPrograms.map((p) => ({
        id: p.id,
        name: p.name,
        description: p.description,
        applicationsOpen: p.applicationsOpen,
        startDate: p.startDate ? new Date(p.startDate).toISOString().slice(0, 10) : null,
        endDate: p.endDate ? new Date(p.endDate).toISOString().slice(0, 10) : null,
        curriculum: p.curriculum?.title ?? null,
      })),
    });
  }

  const programs = await ctx.db.query.program.findMany({
    where: inArray(schema.program.id, targetIds),
    with: {
      curriculum: true,
      programRoles: { with: { user: true } },
    },
  });

  return JSON.stringify({
    programs: programs.map((p) => ({
      id: p.id,
      name: p.name,
      description: p.description,
      applicationsOpen: p.applicationsOpen,
      startDate: p.startDate ? new Date(p.startDate).toISOString().slice(0, 10) : null,
      endDate: p.endDate ? new Date(p.endDate).toISOString().slice(0, 10) : null,
      curriculum: p.curriculum?.title ?? null,
      curriculumDescription: p.curriculum?.description ?? null,
      staff: p.programRoles?.map((r) => ({
        name: r.user?.name ?? "Unknown",
        role: r.name,
      })),
    })),
  });
}

function numMeta(v: unknown) {
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}

function strMeta(v: unknown) {
  return typeof v === "string" && v.trim() ? v : null;
}
