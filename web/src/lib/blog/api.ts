/**
 * Shared plumbing for the two post autosave endpoints.
 *
 * Both do the same three things before they can touch a post — resolve the
 * session, resolve the author's profile, and refuse anyone whose profile is not
 * published — and getting any of them wrong is an authorisation bug rather than
 * a bug in saving. Writing it once means the create and update routes cannot
 * drift apart on the part that matters.
 */
import { env } from "cloudflare:workers";
import { drizzle } from "drizzle-orm/d1";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { createAuth } from "@/lib/auth";
import * as schema from "@/lib/db/schema";
import type { Database } from "@/lib/db/schema";
import type { PostInput } from "@/components/blog/blog-handlers";

export const postBodySchema = z.object({
  title: z.string().max(200),
  slug: z.string().max(80),
  excerpt: z.string().max(300),
  contentMarkdown: z.string().max(40_000),
});

export function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

export type AuthorContext = { db: Database; profileId: string };

/**
 * The author behind the request, or the response to send instead.
 *
 * Blog access is gated on a published profile everywhere else in the feature,
 * and this is the path that does not go through the page. Leaving the check to
 * the page would mean an unpublished — or suspended — profile could still
 * create posts by calling the endpoint directly.
 */
export async function resolveAuthor(
  request: Request
): Promise<AuthorContext | Response> {
  const auth = createAuth(env);
  const session = await auth.api.getSession({ headers: request.headers });
  if (!session?.user) return json({ error: "unauthorized" }, 401);

  const db = drizzle(env.DB, { schema });
  const profile = await db.query.studentProfile.findFirst({
    where: eq(schema.studentProfile.userId, session.user.id),
    columns: { id: true, status: true },
  });

  if (!profile || profile.status !== "PUBLISHED") {
    return json({ error: "Publishing requires a published profile" }, 403);
  }

  return { db, profileId: profile.id };
}

export async function readPostBody(
  request: Request
): Promise<PostInput | Response> {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return json({ error: "Invalid JSON" }, 400);
  }

  const parsed = postBodySchema.safeParse(body);
  if (!parsed.success) {
    return json({ error: "Validation failed" }, 400);
  }

  return {
    title: parsed.data.title,
    slug: parsed.data.slug,
    contentMarkdown: parsed.data.contentMarkdown,
    // An empty excerpt means "derive one", which is not the same as an excerpt
    // of "". Passing the empty string through would store it verbatim and the
    // blog index would show a post with no summary at all.
    excerpt: parsed.data.excerpt || undefined,
  };
}
