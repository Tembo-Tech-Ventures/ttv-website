import type { APIRoute } from "astro";
import { env } from "cloudflare:workers";
import { FeedbackValidationError } from "@/lib/feedback/model";
import { parseThemeCreate, toThemeJson } from "@/lib/feedback/theme-api";
import { createTheme, listThemes } from "@/lib/feedback/theme-store";
import { parseThemeStatusFilter } from "@/lib/feedback/themes";

function json(body: unknown, status = 200): Response {
  return Response.json(body, { status, headers: { "Cache-Control": "no-store" } });
}

/**
 * Feedback themes for admins and agents. `?status=` takes `open` (default:
 * COLLECTING, PROPOSED, PLANNED, IN_PROGRESS), `all`, or a comma list. Each
 * theme carries its stats and the triage rules' assessment.
 */
export const GET: APIRoute = async ({ url, locals }) => {
  if (!locals.isAdmin) return json({ error: "Forbidden" }, 403);
  let statuses;
  try {
    statuses = parseThemeStatusFilter(url.searchParams.get("status"));
  } catch (error) {
    if (error instanceof FeedbackValidationError) return json({ error: error.message }, 400);
    throw error;
  }
  const now = new Date();
  const themes = await listThemes(env.DB, { statuses, now });
  return json({ items: themes.map((theme) => toThemeJson(theme, url.origin, now)) });
};

/** Creates a theme. Write the title and summary so they could be published. */
export const POST: APIRoute = async ({ request, url, locals }) => {
  if (!locals.isAdmin) return json({ error: "Forbidden" }, 403);
  let input;
  try {
    input = parseThemeCreate(await request.json().catch(() => null));
  } catch (error) {
    if (error instanceof FeedbackValidationError) return json({ error: error.message }, 400);
    throw error;
  }
  const theme = await createTheme(env.DB, input);
  return json(toThemeJson(theme, url.origin), 201);
};
