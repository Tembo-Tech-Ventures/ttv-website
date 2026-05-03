import type { APIRoute } from "astro";
import { env } from "cloudflare:workers";
import { drizzle } from "drizzle-orm/d1";
import { eq } from "drizzle-orm";
import * as schema from "@/lib/db/schema";

export const POST: APIRoute = async ({ request, locals }) => {
  if (!locals.isAdmin) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  const formData =
    request.headers.get("content-type")?.includes("application/json")
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
  await db
    .update(schema.recording)
    .set({ processingStatus: "queued", processingError: null })
    .where(eq(schema.recording.id, recordingId));

  await env.RECORDING_QUEUE.send({
    type: "process_recording",
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
