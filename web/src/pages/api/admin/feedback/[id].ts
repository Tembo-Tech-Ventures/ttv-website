import type { APIRoute } from "astro";
import { env } from "cloudflare:workers";
import { parseFeedbackUpdate, toFeedbackJson } from "@/lib/feedback/api";
import { FeedbackValidationError } from "@/lib/feedback/model";
import { getFeedback, updateFeedback } from "@/lib/feedback/store";

function json(body: unknown, status = 200): Response {
  return Response.json(body, {
    status,
    headers: { "Cache-Control": "no-store" },
  });
}

export const GET: APIRoute = async ({ params, url, locals }) => {
  if (!locals.isAdmin) return json({ error: "Forbidden" }, 403);

  const feedback = await getFeedback(env.DB, params.id ?? "");
  if (!feedback) return json({ error: "Feedback not found." }, 404);
  return json(toFeedbackJson(feedback, url.origin));
};

/**
 * Updates status, the reply the student sees, the internal note, or the link
 * to the fix. Middleware has already required admin:write for tokens and a
 * same-origin request for browsers. Pass `expectedStatus` to claim an item
 * only if nobody else has.
 */
export const PATCH: APIRoute = async ({ params, request, url, locals }) => {
  if (!locals.isAdmin || !locals.user) return json({ error: "Forbidden" }, 403);

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return json({ error: "Send a JSON body." }, 400);
  }

  let update;
  try {
    update = parseFeedbackUpdate(body);
  } catch (error) {
    if (error instanceof FeedbackValidationError) {
      return json({ error: error.message }, 400);
    }
    throw error;
  }

  const result = await updateFeedback(env.DB, params.id ?? "", update.patch, {
    actorId: locals.user.id,
    expectedStatus: update.expectedStatus,
  });
  if (result.outcome === "not-found") {
    return json({ error: "Feedback not found." }, 404);
  }
  if (result.outcome === "invalid") {
    return json({ error: result.message }, 400);
  }
  if (result.outcome === "conflict") {
    return json(
      {
        error: `Feedback is ${result.feedback.status}, not ${update.expectedStatus}.`,
        feedback: toFeedbackJson(result.feedback, url.origin),
      },
      409
    );
  }
  return json(toFeedbackJson(result.feedback, url.origin));
};
