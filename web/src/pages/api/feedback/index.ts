import type { APIRoute } from "astro";
import { env } from "cloudflare:workers";
import { isSameOriginRequest } from "@/lib/agent-auth";
import { FeedbackValidationError } from "@/lib/feedback/model";
import { FeedbackRateLimitError, submitFeedback } from "@/lib/feedback/submit";

function json(body: unknown, status: number): Response {
  return Response.json(body, {
    status,
    headers: { "Cache-Control": "no-store" },
  });
}

/** Receives the feedback widget's multipart submission. */
export const POST: APIRoute = async ({ request, locals }) => {
  if (!locals.user) {
    return json({ error: "Sign in to send feedback." }, 401);
  }
  if (!isSameOriginRequest(request)) {
    return json({ error: "Feedback must be sent from this site." }, 403);
  }

  let formData: FormData;
  try {
    formData = await request.formData();
  } catch {
    return json({ error: "The feedback form could not be read." }, 400);
  }

  try {
    const { id } = await submitFeedback(
      {
        formData,
        userId: locals.user.id,
        requestUrl: request.url,
        appVersion: env.DEPLOYMENT_VERSION ?? null,
      },
      { db: env.DB, bucket: env.BUCKET }
    );
    return json({ id }, 201);
  } catch (error) {
    if (error instanceof FeedbackValidationError) {
      return json({ error: error.message }, 400);
    }
    if (error instanceof FeedbackRateLimitError) {
      return json({ error: error.message }, 429);
    }
    throw error;
  }
};
