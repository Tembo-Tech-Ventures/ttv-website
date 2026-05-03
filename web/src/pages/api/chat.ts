import type { APIRoute } from "astro";
import { env } from "cloudflare:workers";
import { drizzle } from "drizzle-orm/d1";
import { inArray } from "drizzle-orm";
import * as schema from "@/lib/db/schema";
import { getAccessibleProgramIds } from "@/lib/recordings/access";
import { formatTimestamp } from "@/lib/recordings/time-utils";

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

  const segmentIds = results.matches
    .map((match) => match.metadata?.segment_id)
    .filter((id): id is string => typeof id === "string");

  if (segmentIds.length === 0) {
    return Response.json({
      answer: "I could not find a relevant transcript segment for that question.",
      citations: [],
    });
  }

  const segments = await db.query.transcriptSegment.findMany({
    where: inArray(schema.transcriptSegment.id, segmentIds),
    with: { recording: true },
  });

  const context = segments
    .map(
      (segment) =>
        `[Session: "${segment.recording.title}" | ${formatTimestamp(segment.startTime)}-${formatTimestamp(segment.endTime)}]\n${segment.text}`
    )
    .join("\n\n");

  const system = `You are a helpful assistant for TTV students. Answer only from the transcript excerpts. Cite session titles and timestamps when they support the answer.\n\n${context}`;

  let answer: string;
  if (env.ANTHROPIC_API_KEY) {
    const claudeResponse = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "x-api-key": env.ANTHROPIC_API_KEY,
        "anthropic-version": "2023-06-01",
        "content-type": "application/json",
      },
      body: JSON.stringify({
        model: "claude-sonnet-4-20250514",
        max_tokens: 1024,
        system,
        messages: [
          ...conversationHistory
            .filter((entry) => entry.role === "user" || entry.role === "assistant")
            .map((entry) => ({
              role: entry.role,
              content: String(entry.content).slice(0, 1000),
            })),
          { role: "user", content: message },
        ],
      }),
    });
    const payload = (await claudeResponse.json()) as {
      error?: { message?: string };
      content?: Array<{ text?: string }>;
    };
    if (!claudeResponse.ok) {
      throw new Error(payload.error?.message ?? "Claude generation failed");
    }
    answer = payload.content?.[0]?.text ?? "";
  } else {
    const llamaResponse = (await env.AI.run("@cf/meta/llama-3.1-8b-instruct" as any, {
      messages: [
        { role: "system", content: system },
        { role: "user", content: message },
      ],
    })) as { response?: string; result?: { response?: string } };
    answer = llamaResponse.response ?? llamaResponse.result?.response ?? "";
  }

  const citations = segments.map((segment) => ({
    recordingId: segment.recordingId,
    title: segment.recording.title,
    startTime: segment.startTime,
    endTime: segment.endTime,
    text:
      segment.text.length > 180
        ? `${segment.text.slice(0, 180).trim()}...`
        : segment.text,
  }));

  await db.insert(schema.chatMessage).values([
    { userId: user.id, role: "user", content: message },
    { userId: user.id, role: "assistant", content: answer, citations: JSON.stringify(citations) },
  ]);

  return Response.json({ answer, citations });
};
