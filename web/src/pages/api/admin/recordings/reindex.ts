import type { APIRoute } from "astro";
import { env } from "cloudflare:workers";
import { drizzle } from "drizzle-orm/d1";
import { eq } from "drizzle-orm";
import * as schema from "@/lib/db/schema";

/**
 * Re-embeds an already-transcribed recording and re-upserts its vectors.
 *
 * Unlike `process`, this skips download/encode/transcription entirely — it only
 * rebuilds the Vectorize entries from the transcript segments already in D1.
 * Needed after a Vectorize metadata index is added, because Vectorize only
 * indexes metadata for vectors upserted after the metadata index exists.
 */
export const POST: APIRoute = async ({ request, locals }) => {
  if (!locals.isAdmin) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  const formData = request.headers
    .get("content-type")
    ?.includes("application/json")
    ? null
    : await request.formData();
  const body = formData
    ? null
    : ((await request.json()) as { recordingId?: string });
  const recordingId =
    (formData?.get("recordingId") as string | null) ?? body?.recordingId;

  if (!recordingId) {
    return Response.json({ error: "recordingId is required" }, { status: 400 });
  }

  const db = drizzle(env.DB, { schema });
  const existing = await db.query.recording.findFirst({
    where: eq(schema.recording.id, recordingId),
    columns: { id: true },
  });
  if (!existing) {
    return Response.json({ error: "Recording not found" }, { status: 404 });
  }

  await env.RECORDING_QUEUE.send({
    type: "reindex_recording",
    recordingId,
  });

  if (formData) {
    return new Response(null, {
      status: 303,
      headers: { location: `/admin/recordings/${recordingId}` },
    });
  }

  return Response.json({ success: true });
};
