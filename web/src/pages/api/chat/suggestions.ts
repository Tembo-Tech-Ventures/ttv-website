import type { APIRoute } from "astro";
import { env } from "cloudflare:workers";
import { drizzle } from "drizzle-orm/d1";
import { and, desc, eq, inArray } from "drizzle-orm";
import * as schema from "@/lib/db/schema";
import { getAccessibleProgramIds } from "@/lib/recordings/access";

export const GET: APIRoute = async ({ locals }) => {
  const user = locals.user;
  if (!user) return Response.json({ suggestions: [] });

  const db = drizzle(env.DB, { schema });
  const programIds = await getAccessibleProgramIds(db, user.id);

  if (programIds.length === 0) {
    return Response.json({
      suggestions: [
        "What programs does TTV offer?",
        "What's my application status?",
        "How does the training work?",
      ],
    });
  }

  const recordings = await db
    .select({ title: schema.recording.title })
    .from(schema.recording)
    .where(
      and(
        eq(schema.recording.processingStatus, "complete"),
        inArray(schema.recording.programId, programIds)
      )
    )
    .orderBy(desc(schema.recording.recordedAt))
    .limit(3);

  if (recordings.length === 0) {
    return Response.json({
      suggestions: [
        "Tell me about my program",
        "What topics are in the curriculum?",
        "Who are the instructors?",
      ],
    });
  }

  const suggestions = recordings.map(
    (r) => `What were the key takeaways from "${r.title}"?`
  );

  return Response.json({ suggestions });
};
