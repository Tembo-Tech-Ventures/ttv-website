import type { APIRoute } from "astro";
import { env } from "cloudflare:workers";
import { drizzle } from "drizzle-orm/d1";
import { eq } from "drizzle-orm";
import * as schema from "@/lib/db/schema";
import {
  parseRecordingProcessRequest,
  RecordingProcessRequestError,
} from "@/lib/recordings/process-request";

export const POST: APIRoute = async ({ request, locals }) => {
  if (!locals.isAdmin) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  let requestInput;
  try {
    requestInput = await parseRecordingProcessRequest(request);
  } catch (error) {
    if (!(error instanceof RecordingProcessRequestError)) throw error;
    return Response.json({ error: error.message }, { status: 400 });
  }
  const { recordingId, submittedAsForm } = requestInput;

  const db = drizzle(env.DB, { schema });
  const existing = await db.query.recording.findFirst({
    where: eq(schema.recording.id, recordingId),
    columns: { id: true },
  });
  if (!existing) {
    return Response.json({ error: "Recording not found" }, { status: 404 });
  }

  await db
    .update(schema.recording)
    .set({ processingStatus: "queued", processingError: null })
    .where(eq(schema.recording.id, recordingId));

  await env.RECORDING_QUEUE.send({
    type: "process_recording",
    recordingId,
  });

  if (submittedAsForm) {
    return new Response(null, {
      status: 303,
      headers: { location: `/admin/recordings/${recordingId}` },
    });
  }

  return Response.json({ success: true });
};
