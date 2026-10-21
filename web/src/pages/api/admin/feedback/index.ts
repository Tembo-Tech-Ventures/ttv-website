import type { APIRoute } from "astro";
import { env } from "cloudflare:workers";
import { toFeedbackJson } from "@/lib/feedback/api";
import {
  FeedbackValidationError,
  FEEDBACK_KINDS,
  parseFeedbackStatusFilter,
  type FeedbackKind,
} from "@/lib/feedback/model";
import { countFeedbackByStatus, listFeedback } from "@/lib/feedback/store";

function json(body: unknown, status = 200): Response {
  return Response.json(body, {
    status,
    headers: { "Cache-Control": "no-store" },
  });
}

/**
 * Lists feedback for admins and for agents holding an admin personal access
 * token. `?status=` takes `open` (default), `all`, or a comma list such as
 * `NEW,IN_PROGRESS`; `?kind=BUG` narrows by kind; `?untriaged=1` keeps notes
 * with no theme that are not sensitive; `?themeId=` lists one theme's notes;
 * `?limit=` caps at 200.
 */
export const GET: APIRoute = async ({ url, locals }) => {
  if (!locals.isAdmin) return json({ error: "Forbidden" }, 403);

  let statuses;
  try {
    statuses = parseFeedbackStatusFilter(url.searchParams.get("status"));
  } catch (error) {
    if (error instanceof FeedbackValidationError) {
      return json({ error: error.message }, 400);
    }
    throw error;
  }

  const kindParam = url.searchParams.get("kind")?.toUpperCase() ?? null;
  if (kindParam && !(FEEDBACK_KINDS as readonly string[]).includes(kindParam)) {
    return json(
      { error: `Unknown kind. Use one of ${FEEDBACK_KINDS.join(", ")}.` },
      400
    );
  }

  const [items, counts] = await Promise.all([
    listFeedback(env.DB, {
      statuses,
      kind: kindParam as FeedbackKind | null,
      untriaged: url.searchParams.get("untriaged") === "1",
      themeId: url.searchParams.get("themeId"),
      limit: Number(url.searchParams.get("limit") ?? 50),
    }),
    countFeedbackByStatus(env.DB),
  ]);

  return json({
    counts,
    items: items.map((item) => toFeedbackJson(item, url.origin)),
  });
};
