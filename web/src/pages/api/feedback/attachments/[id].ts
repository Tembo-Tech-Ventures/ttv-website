import type { APIRoute } from "astro";
import { env } from "cloudflare:workers";
import { userHasAdminRole } from "@/lib/admin/roles";
import { getFeedbackAttachmentObject } from "@/lib/feedback/store";

const NOT_FOUND = () =>
  new Response("Not found", {
    status: 404,
    headers: { "Cache-Control": "no-store" },
  });

/**
 * Serves a feedback screenshot to the student who sent it and to admins
 * (including agents holding an admin personal access token). Screenshots can
 * show anything on the student's screen, so they are never public, and a
 * stranger gets the same 404 as a missing file.
 */
export const GET: APIRoute = async ({ params, locals }) => {
  if (!locals.user) {
    return new Response("Unauthorized", {
      status: 401,
      headers: { "Cache-Control": "no-store" },
    });
  }

  const attachment = await getFeedbackAttachmentObject(env.DB, params.id ?? "");
  if (!attachment) return NOT_FOUND();
  if (
    attachment.ownerId !== locals.user.id &&
    !(await userHasAdminRole(env.DB, locals.user.id))
  ) {
    return NOT_FOUND();
  }

  const object = await env.BUCKET.get(attachment.objectKey);
  if (!object) return NOT_FOUND();

  return new Response(object.body, {
    headers: {
      // The type was sniffed from the bytes at upload, never taken from R2
      // metadata or the original request.
      "Content-Type": attachment.contentType,
      "Content-Length": String(object.size),
      "Cache-Control": "private, max-age=3600",
      "Content-Disposition": "inline",
      "Content-Security-Policy": "default-src 'none'; sandbox",
      "X-Content-Type-Options": "nosniff",
    },
  });
};
