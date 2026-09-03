import type { APIRoute } from "astro";
import { env } from "cloudflare:workers";
import { drizzle } from "drizzle-orm/d1";
import * as schema from "@/lib/db/schema";
import { ensureOwnedChatSession, touchChatSession } from "@/lib/chat/sessions";
import { getAccessibleProgramIds } from "@/lib/recordings/access";
import { generateToolCompletion, type GatewayMessage } from "@/lib/ai/gateway";
import { TOOL_DEFINITIONS, executeTool, type ToolContext, type TranscriptSource } from "@/lib/chat/tools";

const MAX_TOOL_ROUNDS = 3;
const MAX_ANSWER_TOKENS = 1200;

function sanitizeModelAnswer(answer: string) {
  return answer.replace(/<think>[\s\S]*?<\/think>/gi, "").trim();
}

async function checkIsAdmin(db: D1Database, userId: string): Promise<boolean> {
  const result = await db
    .prepare(
      `SELECT ur.id FROM "UserRoles" ur
       JOIN "Roles" r ON ur."roleId" = r."id"
       WHERE ur."userId" = ? AND r."name" = 'ADMIN'
       LIMIT 1`
    )
    .bind(userId)
    .first();
  return Boolean(result);
}

function buildSystemPrompt(userName: string, hasRecordings: boolean): string {
  const base = `You are TTV's AI assistant, helping students, mentors, and staff at Tembo Tech Ventures, a tech training platform focused on developing Africa's tech ecosystem.

You are speaking with ${userName}.

You have tools to look up information. Use them before answering — do not guess.`;

  const transcriptGuidance = hasRecordings
    ? `
When answering from session recordings:
- Cite every substantive claim with inline source markers like [1] or [2] that match the sourceNumber from search results.
- Synthesize — do not just restate raw transcript snippets.
- Transcript text may contain speech-to-text errors. Clean up obvious typos in your explanations.
- If sources lack enough information, say what is missing.

For questions about recent, latest, or specific sessions: call list_recordings first to identify the right recording by date, then use search_transcripts with that recording_id or get_recording_details to read it. Do not rely on search_transcripts alone for time-based questions — semantic search does not understand recency.

When a question goes beyond what the recordings cover (e.g. general programming help), you may answer from your own knowledge but clearly say "This is general guidance, not from your sessions" so the user knows the difference.`
    : `
This user does not have access to session recordings yet. You can still help them with:
- Questions about their application status (use the get_user_context tool)
- Information about TTV programs (use the get_program_info tool)
- General programming questions (clearly marked as general knowledge)`;

  return `${base}
${transcriptGuidance}

Keep answers concise unless the question asks for depth.`;
}

function buildCitations(sources: TranscriptSource[]) {
  return sources.map((source) => ({
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

  const [programIds, isAdmin] = await Promise.all([
    getAccessibleProgramIds(db, user.id),
    checkIsAdmin(env.DB, user.id),
  ]);

  const hasRecordings = programIds.length > 0 || isAdmin;
  const systemPrompt = buildSystemPrompt(user.name, hasRecordings);

  const toolCtx: ToolContext = {
    env,
    db,
    userId: user.id,
    userName: user.name,
    programIds,
    isAdmin,
    sources: [],
  };

  const tools = hasRecordings ? TOOL_DEFINITIONS : TOOL_DEFINITIONS.filter(
    (t) => t.function.name !== "search_transcripts" &&
           t.function.name !== "list_recordings" &&
           t.function.name !== "get_recording_details"
  );

  const messages: GatewayMessage[] = [
    { role: "system", content: systemPrompt },
    ...conversationHistory
      .filter((entry) => entry.role === "user" || entry.role === "assistant")
      .map((entry) => ({
        role: entry.role as "user" | "assistant",
        content: String(entry.content).slice(0, 1000),
      })),
    { role: "user", content: message },
  ];

  let answer = "";
  for (let round = 0; round <= MAX_TOOL_ROUNDS; round++) {
    const isLastRound = round === MAX_TOOL_ROUNDS;
    const result = await generateToolCompletion(env, messages, {
      maxTokens: MAX_ANSWER_TOKENS,
      temperature: 0.2,
      tools: isLastRound ? undefined : tools,
    });

    if (result.toolCalls.length > 0 && !isLastRound) {
      messages.push({ role: "assistant", content: null, tool_calls: result.toolCalls });

      for (const call of result.toolCalls) {
        let args: Record<string, unknown> = {};
        try {
          args = JSON.parse(call.function.arguments) as Record<string, unknown>;
        } catch {
          // Malformed arguments — pass empty
        }
        const toolResult = await executeTool(call.function.name, args, toolCtx);
        messages.push({ role: "tool", tool_call_id: call.id, content: toolResult });
      }
      continue;
    }

    answer = sanitizeModelAnswer(result.content ?? "");
    break;
  }

  if (!answer) {
    answer = hasRecordings
      ? "I wasn't able to generate an answer for that question. Could you try rephrasing it?"
      : "I wasn't able to help with that. Try asking about your application status or TTV programs.";
  }

  const citations = buildCitations(toolCtx.sources);

  await db.insert(schema.chatMessage).values([
    { userId: user.id, sessionId, role: "user", content: message },
    { userId: user.id, sessionId, role: "assistant", content: answer, citations: JSON.stringify(citations) },
  ]);
  await touchChatSession(env.DB, user.id, sessionId);

  return Response.json({ sessionId, answer, citations });
};
