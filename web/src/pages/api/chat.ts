import type { APIRoute } from "astro";
import { env } from "cloudflare:workers";
import { drizzle } from "drizzle-orm/d1";
import { and, asc, eq, inArray } from "drizzle-orm";
import * as schema from "@/lib/db/schema";
import { ensureOwnedChatSession, touchChatSession } from "@/lib/chat/sessions";
import { getAccessibleProgramIds } from "@/lib/recordings/access";
import { formatTimestamp } from "@/lib/recordings/time-utils";
import { generateChatCompletion, type ChatMessage } from "@/lib/ai/gateway";

interface VectorMatchMetadata {
  segment_id?: unknown;
  recording_id?: unknown;
  start_time?: unknown;
  end_time?: unknown;
}

interface TranscriptSource {
  sourceNumber: number;
  recordingId: string;
  title: string;
  startTime: number;
  endTime: number;
  text: string;
}

function numberFromMetadata(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function stringFromMetadata(value: unknown) {
  return typeof value === "string" && value.trim() ? value : null;
}

function sanitizeModelAnswer(answer: string) {
  return answer.replace(/<think>[\s\S]*?<\/think>/gi, "").trim();
}

function buildSourceText(source: TranscriptSource) {
  return [
    `[${source.sourceNumber}] ${source.title}`,
    `Timecode: ${formatTimestamp(source.startTime)}-${formatTimestamp(source.endTime)}`,
    `Video link: /dashboard/sessions/${source.recordingId}?t=${Math.floor(source.startTime)}`,
    `Transcript: ${source.text}`,
  ].join("\n");
}

function buildFallbackAnswer(sources: TranscriptSource[]) {
  const summary = sources
    .slice(0, 3)
    .map(
      (source) =>
        `[${source.sourceNumber}] ${source.title} at ${formatTimestamp(source.startTime)}: ${source.text}`
    )
    .join("\n\n");

  return `I found relevant transcript references, but the answer model returned an empty response. Here are the most relevant excerpts so you can jump into the recording:\n\n${summary}`;
}

interface ParsedMatch {
  segmentId: string | null;
  recordingId: string | null;
  startTime: number | null;
  endTime: number | null;
}

async function saveAndReturn(
  db: schema.Database,
  userId: string,
  sessionId: string,
  message: string,
  answer: string,
  citations: unknown[]
) {
  await db.insert(schema.chatMessage).values([
    { userId, sessionId, role: "user", content: message },
    { userId, sessionId, role: "assistant", content: answer, citations: JSON.stringify(citations) },
  ]);
  await touchChatSession(env.DB, userId, sessionId);
  return Response.json({ sessionId, answer, citations });
}

async function findTranscriptSources(
  db: schema.Database,
  isAdmin: boolean,
  matches: ParsedMatch[],
  segmentIds: string[],
  recordingIds: string[],
  programIds: string[]
): Promise<TranscriptSource[]> {
  const segmentRows = await db
    .select({
      id: schema.transcriptSegment.id,
      recordingId: schema.transcriptSegment.recordingId,
      startTime: schema.transcriptSegment.startTime,
      endTime: schema.transcriptSegment.endTime,
      text: schema.transcriptSegment.text,
      recordingTitle: schema.recording.title,
      recordingProgramId: schema.recording.programId,
    })
    .from(schema.transcriptSegment)
    .innerJoin(schema.recording, eq(schema.transcriptSegment.recordingId, schema.recording.id))
    .where(
      isAdmin
        ? recordingIds.length > 0
          ? inArray(schema.recording.id, recordingIds)
          : inArray(schema.transcriptSegment.id, segmentIds)
        : and(
            recordingIds.length > 0
              ? inArray(schema.recording.id, recordingIds)
              : inArray(schema.transcriptSegment.id, segmentIds),
            inArray(schema.recording.programId, programIds)
          )
    )
    .orderBy(asc(schema.transcriptSegment.startTime));

  const rowsByRecordingId = new Map<string, typeof segmentRows>();
  for (const row of segmentRows) {
    rowsByRecordingId.set(row.recordingId, [
      ...(rowsByRecordingId.get(row.recordingId) ?? []),
      row,
    ]);
  }
  const sources: TranscriptSource[] = [];
  const seenRanges = new Set<string>();
  for (const match of matches) {
    const rows = match.recordingId ? rowsByRecordingId.get(match.recordingId) ?? [] : segmentRows;
    const matchedRows =
      match.startTime !== null && match.endTime !== null
        ? rows.filter(
            (row) =>
              row.startTime < match.endTime! + 0.5 &&
              row.endTime > match.startTime! - 0.5
          )
        : rows.filter((row) => row.id === match.segmentId);

    if (matchedRows.length === 0) continue;

    const firstRow = matchedRows[0];
    const lastRow = matchedRows.at(-1) ?? firstRow;
    const dedupeKey = `${firstRow.recordingId}:${Math.floor(firstRow.startTime)}:${Math.floor(lastRow.endTime)}`;
    if (seenRanges.has(dedupeKey)) continue;
    seenRanges.add(dedupeKey);

    sources.push({
      sourceNumber: sources.length + 1,
      recordingId: firstRow.recordingId,
      title: firstRow.recordingTitle,
      startTime: firstRow.startTime,
      endTime: lastRow.endTime,
      text: matchedRows.map((row) => row.text).join(" "),
    });

    if (sources.length >= 8) break;
  }

  return sources;
}

export const POST: APIRoute = async ({ request, locals }) => {
  const user = locals.user;
  if (!user) return Response.json({ error: "Unauthorized" }, { status: 401 });

  const { message, sessionId: requestedSessionId, conversationHistory = [] } = (await request.json()) as {
    message?: string;
    sessionId?: string | null;
    conversationHistory?: Array<{ role: string; content: string }>;
  };
  if (!message || typeof message !== "string") {
    return Response.json({ error: "message is required" }, { status: 400 });
  }
  if (message.length > 2000) {
    return Response.json({ error: "message is too long" }, { status: 400 });
  }

  const db = drizzle(env.DB, { schema });
  const sessionId = await ensureOwnedChatSession(
    env.DB,
    user.id,
    typeof requestedSessionId === "string" ? requestedSessionId : null,
    message
  );
  const programIds = await getAccessibleProgramIds(db, user.id);
  if (programIds.length === 0 && !locals.isAdmin) {
    return saveAndReturn(
      db, user.id, sessionId, message,
      "No session recordings are available for your account yet.", []
    );
  }

  const embedding = (await env.AI.run("@cf/baai/bge-m3", {
    text: [message],
  })) as { data?: number[][]; result?: { data?: number[][] } };
  const vector = embedding.data?.[0] ?? embedding.result?.data?.[0];
  if (!Array.isArray(vector)) {
    return Response.json({ error: "Unable to embed question" }, { status: 500 });
  }

  const results = await env.VECTORIZE.query(vector, {
    topK: 50,
    returnMetadata: "all",
  });

  const matches = results.matches
    .map((match) => {
      const metadata = (match.metadata ?? {}) as VectorMatchMetadata;
      return {
        segmentId: stringFromMetadata(metadata.segment_id),
        recordingId: stringFromMetadata(metadata.recording_id),
        startTime: numberFromMetadata(metadata.start_time),
        endTime: numberFromMetadata(metadata.end_time),
      };
    })
    .filter((match) => match.segmentId || match.recordingId);

  const segmentIds = matches
    .map((match) => match.segmentId)
    .filter((id): id is string => Boolean(id));

  const recordingIds = Array.from(
    new Set(matches.map((match) => match.recordingId).filter((id): id is string => Boolean(id)))
  );

  if (segmentIds.length === 0 && recordingIds.length === 0) {
    return saveAndReturn(
      db, user.id, sessionId, message,
      "I could not find a relevant transcript segment for that question.", []
    );
  }

  const sources = await findTranscriptSources(
    db, !!locals.isAdmin, matches, segmentIds, recordingIds, programIds
  );

  if (sources.length === 0) {
    return saveAndReturn(
      db, user.id, sessionId, message,
      "I could not find a relevant transcript segment for that question.", []
    );
  }

  const context = sources.map(buildSourceText).join("\n\n---\n\n");

  const system = `You are TTV's session assistant. Answer the user's question in natural language using only the provided transcript sources.

Requirements:
- Synthesize the relevant points; do not just restate raw transcript snippets.
- For technical questions, reason through the steps and call out assumptions or uncertainty.
- Transcript text may contain speech-to-text mistakes, punctuation errors, missing capitalization, and homophone typos. Infer the intended wording from context when it is clear, clean up those errors in your explanation, and do not preserve obvious transcript typos unless quoting them is necessary.
- Cite every substantive claim with inline source markers like [1] or [2].
- If the sources do not contain enough information, say what is missing and cite the closest relevant source.
- Do not mention sources that are not useful for the answer.
- Keep the answer concise unless the question asks for depth.

Transcript sources:

${context}`;

  const messages: ChatMessage[] = [
    { role: "system", content: system },
    ...conversationHistory
      .filter((entry) => entry.role === "user" || entry.role === "assistant")
      .map((entry) => ({
        role: entry.role as "user" | "assistant",
        content: String(entry.content).slice(0, 1000),
      })),
    { role: "user", content: message },
  ];
  const generatedAnswer = sanitizeModelAnswer(
    await generateChatCompletion(env, messages, {
      maxTokens: 900,
      temperature: 0.2,
    })
  );
  const answer = generatedAnswer || buildFallbackAnswer(sources);

  const citations = sources.map((source) => ({
    sourceNumber: source.sourceNumber,
    recordingId: source.recordingId,
    title: source.title,
    startTime: source.startTime,
    endTime: source.endTime,
    url: `/dashboard/sessions/${source.recordingId}?t=${Math.floor(source.startTime)}`,
    text:
      source.text.length > 240
        ? `${source.text.slice(0, 240).trim()}...`
        : source.text,
  }));

  return saveAndReturn(db, user.id, sessionId, message, answer, citations);
};
