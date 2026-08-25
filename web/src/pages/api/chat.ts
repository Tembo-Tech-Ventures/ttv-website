import type { APIRoute } from "astro";
import { env } from "cloudflare:workers";
import { drizzle } from "drizzle-orm/d1";
import { inArray } from "drizzle-orm";
import * as schema from "@/lib/db/schema";
import { getAccessibleProgramIds } from "@/lib/recordings/access";
import { formatTimestamp } from "@/lib/recordings/time-utils";
import { generateChatCompletion, type ChatMessage } from "@/lib/ai/gateway";

export const POST: APIRoute = async ({ request, locals }) => {
  const user = locals.user;
  if (!user) return Response.json({ error: "Unauthorized" }, { status: 401 });

  const { message, conversationHistory = [] } = (await request.json()) as {
    message?: string;
    conversationHistory?: Array<{ role: string; content: string }>;
  };
  if (!message || typeof message !== "string") {
    return Response.json({ error: "message is required" }, { status: 400 });
  }
  if (message.length > 2000) {
    return Response.json({ error: "message is too long" }, { status: 400 });
  }

  const db = drizzle(env.DB, { schema });
  const programIds = await getAccessibleProgramIds(db, user.id);
  if (programIds.length === 0 && !locals.isAdmin) {
    return Response.json({
      answer: "No session recordings are available for your account yet.",
      citations: [],
    });
  }

  const embedding = (await env.AI.run("@cf/baai/bge-m3", {
    text: [message],
  })) as { data?: number[][]; result?: { data?: number[][] } };
  const vector = embedding.data?.[0] ?? embedding.result?.data?.[0];
  if (!Array.isArray(vector)) {
    return Response.json({ error: "Unable to embed question" }, { status: 500 });
  }

  const results = await env.VECTORIZE.query(vector, {
    topK: 8,
    returnMetadata: "all",
    filter: locals.isAdmin ? undefined : { program_id: { $in: programIds } },
  });

  const vectorIds = results.matches.map((match) => match.id);

  if (vectorIds.length === 0) {
    return Response.json({
      answer: "I could not find a relevant transcript segment for that question.",
      citations: [],
    });
  }

  // Each vector covers a multi-segment chunk, so rebuild the chunk from every
  // segment tagged with that vector id rather than a single short segment.
  const segments = await db.query.transcriptSegment.findMany({
    where: inArray(schema.transcriptSegment.vectorId, vectorIds),
    orderBy: (segment, { asc }) => [asc(segment.startTime)],
    with: { recording: true },
  });

  const chunks = vectorIds
    .map((vectorId) => segments.filter((segment) => segment.vectorId === vectorId))
    .filter((chunkSegments) => chunkSegments.length > 0)
    .map((chunkSegments) => {
      const first = chunkSegments[0];
      const last = chunkSegments[chunkSegments.length - 1];
      return {
        recordingId: first.recordingId,
        title: first.recording.title,
        startTime: first.startTime,
        endTime: last.endTime,
        text: chunkSegments.map((segment) => segment.text).join(" "),
      };
    });

  if (chunks.length === 0) {
    return Response.json({
      answer: "I could not find a relevant transcript segment for that question.",
      citations: [],
    });
  }

  const context = chunks
    .map(
      (chunk) =>
        `[Session: "${chunk.title}" | ${formatTimestamp(chunk.startTime)}-${formatTimestamp(chunk.endTime)}]\n${chunk.text}`
    )
    .join("\n\n");

  const system = `You are a helpful assistant for TTV students. Answer only from the transcript excerpts. Cite session titles and timestamps when they support the answer.\n\n${context}`;

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
  const answer = await generateChatCompletion(env, messages);

  const citations = chunks.map((chunk) => ({
    recordingId: chunk.recordingId,
    title: chunk.title,
    startTime: chunk.startTime,
    endTime: chunk.endTime,
    text:
      chunk.text.length > 180
        ? `${chunk.text.slice(0, 180).trim()}...`
        : chunk.text,
  }));

  await db.insert(schema.chatMessage).values([
    { userId: user.id, role: "user", content: message },
    { userId: user.id, role: "assistant", content: answer, citations: JSON.stringify(citations) },
  ]);

  return Response.json({ answer, citations });
};
