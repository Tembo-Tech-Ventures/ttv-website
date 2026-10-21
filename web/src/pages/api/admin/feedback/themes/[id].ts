import type { APIRoute } from "astro";
import { env } from "cloudflare:workers";
import { FeedbackValidationError } from "@/lib/feedback/model";
import { parseThemeUpdate, toThemeJson } from "@/lib/feedback/theme-api";
import { getTheme, listThemeNoteIds, updateTheme } from "@/lib/feedback/theme-store";

function json(body: unknown, status = 200): Response {
  return Response.json(body, { status, headers: { "Cache-Control": "no-store" } });
}

export const GET: APIRoute = async ({ params, url, locals }) => {
  if (!locals.isAdmin) return json({ error: "Forbidden" }, 403);
  const theme = await getTheme(env.DB, params.id ?? "");
  if (!theme) return json({ error: "Theme not found." }, 404);
  return json({
    ...toThemeJson(theme, url.origin),
    noteIds: await listThemeNoteIds(env.DB, theme.id),
  });
};

/**
 * Moves a theme along. Shipping or declining it closes every open note on it
 * with `studentMessage` as the reply and the PR (or issue) as the link.
 */
export const PATCH: APIRoute = async ({ params, request, url, locals }) => {
  if (!locals.isAdmin || !locals.user) return json({ error: "Forbidden" }, 403);
  let update;
  try {
    update = parseThemeUpdate(await request.json().catch(() => null));
  } catch (error) {
    if (error instanceof FeedbackValidationError) return json({ error: error.message }, 400);
    throw error;
  }
  const theme = await updateTheme(env.DB, params.id ?? "", update.patch, {
    actorId: locals.user.id,
    studentMessage: update.studentMessage,
  });
  if (!theme) return json({ error: "Theme not found." }, 404);
  return json(toThemeJson(theme, url.origin));
};
