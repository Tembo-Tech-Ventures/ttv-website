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

  const start = match[1] ? Number(match[1]) : 0;
  const end = match[2] ? Number(match[2]) : size - 1;
  if (!Number.isFinite(start) || !Number.isFinite(end) || start > end) {
    return undefined;
  }

  return { offset: start, length: end - start + 1 };
}

export const GET: APIRoute = async ({ params, request, locals }) => {
  const user = locals.user;
  if (!user) return new Response("Unauthorized", { status: 401 });

  const id = params.id;
  if (!id) return new Response("Not found", { status: 404 });

  const db = drizzle(env.DB, { schema });
  const recording = await db.query.recording.findFirst({
    where: eq(schema.recording.id, id),
  });

  if (!recording?.r2VideoKey) return new Response("Not found", { status: 404 });

  const hasAccess =
    locals.isAdmin ||
    (await userCanAccessProgram(db, user.id, recording.programId));
  if (!hasAccess) return new Response("Forbidden", { status: 403 });

  const head = await env.BUCKET.head(recording.r2VideoKey);
  if (!head) return new Response("Not found", { status: 404 });

  const range = parseRange(request.headers.get("range"), head.size);
  const object = await env.BUCKET.get(
    recording.r2VideoKey,
    range ? { range } : undefined
  );
  if (!object) return new Response("Not found", { status: 404 });

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
