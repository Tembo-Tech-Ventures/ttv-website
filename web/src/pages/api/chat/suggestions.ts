import type { APIRoute } from "astro";
import { env } from "cloudflare:workers";
import { drizzle } from "drizzle-orm/d1";
import { desc, sql } from "drizzle-orm";
import * as schema from "@/lib/db/schema";
import { capabilitiesFor } from "@/lib/platform/server/capabilities";
import { mayReadRecordings, recordingScopeSql, transcriptReadySql } from "@/lib/recordings/access";

export const GET: APIRoute = async ({ locals }) => {
  const user = locals.user;
  if (!user) return Response.json({ suggestions: [] });

  const db = drizzle(env.DB, { schema });
  const capabilities = await capabilitiesFor(db, { id: user.id });

  if (!mayReadRecordings(capabilities)) {
    return Response.json({
      suggestions: [
        "What programs does TTV offer?",
        "What's my application status?",
        "How does the training work?",
      ],
    });
  }

  // The newest sessions Ask Tembo can read for this person: the recording access policy, complete transcripts.
  const recordings = await db
    .select({ title: schema.recording.title })
    .from(schema.recording)
    .where(sql.raw(`${recordingScopeSql(capabilities, user.id)} AND ${transcriptReadySql()}`))
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
