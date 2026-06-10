import type { APIRoute } from "astro";
import { env } from "cloudflare:workers";
import { drizzle } from "drizzle-orm/d1";
import { eq } from "drizzle-orm";
import * as schema from "@/lib/db/schema";
import { userCanAccessProgram } from "@/lib/recordings/access";

function parseRange(range: string | null, size: number) {
  if (!range) return undefined;
  const match = range.match(/^bytes=(\d*)-(\d*)$/);
  if (!match) return undefined;

  let start: number;
  let end: number;

  if (match[1] && match[2]) {
    start = Number(match[1]);
    end = Number(match[2]);
  } else if (match[1]) {
    start = Number(match[1]);
    end = size - 1;
  } else if (match[2]) {
    // Suffix range: "bytes=-500" means last 500 bytes
    const suffix = Number(match[2]);
    start = Math.max(0, size - suffix);
    end = size - 1;
  } else {
    return undefined;
  }

  if (!Number.isFinite(start) || !Number.isFinite(end) || start > end || end >= size) {
    return undefined;
  }

  return { offset: start, length: end - start + 1 };
}

export const GET: APIRoute = async ({ params, request, locals }) => {
  const user = locals.user;
  if (!user) return Response.json({ error: "Unauthorized" }, { status: 401 });

  const id = params.id;
  if (!id) return Response.json({ error: "Not found" }, { status: 404 });

  const db = drizzle(env.DB, { schema });
  const recording = await db.query.recording.findFirst({
    where: eq(schema.recording.id, id),
  });

  if (!recording?.r2VideoKey) return Response.json({ error: "Not found" }, { status: 404 });

  const hasAccess =
    locals.isAdmin ||
    (await userCanAccessProgram(db, user.id, recording.programId));
  if (!hasAccess) return Response.json({ error: "Forbidden" }, { status: 403 });

  const head = await env.BUCKET.head(recording.r2VideoKey);
  if (!head) return Response.json({ error: "Not found" }, { status: 404 });

  const range = parseRange(request.headers.get("range"), head.size);
  const object = await env.BUCKET.get(
    recording.r2VideoKey,
    range ? { range } : undefined
  );
  if (!object) return Response.json({ error: "Not found" }, { status: 404 });

  const headers = new Headers({
    "content-type": object.httpMetadata?.contentType ?? "video/mp4",
    "accept-ranges": "bytes",
    "cache-control": "private, max-age=300",
  });

  if (range) {
    headers.set(
      "content-range",
      `bytes ${range.offset}-${range.offset + range.length - 1}/${head.size}`
    );
    headers.set("content-length", String(range.length));
    return new Response(object.body, { status: 206, headers });
  }

  headers.set("content-length", String(head.size));
  return new Response(object.body, { headers });
};
