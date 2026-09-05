/**
 * Creates the draft behind a post that has never been saved.
 *
 * Separate from the update route so that `/dashboard/writing/new` does not have
 * to create a row before the author has written anything — a page load is not
 * an intention to publish, and an editor that leaves an empty draft behind
 * every time someone opens it and changes their mind is its own bug.
 */
import type { APIRoute } from "astro";
import { savePost } from "@/components/blog/blog-handlers";
import { json, readPostBody, resolveAuthor } from "@/lib/blog/api";

export const POST: APIRoute = async ({ request }) => {
  const author = await resolveAuthor(request);
  if (author instanceof Response) return author;

  const input = await readPostBody(request);
  if (input instanceof Response) return input;

  const result = await savePost(author.db, author.profileId, input);
  if (!result.success || !result.postId || !result.saved) {
    return json(
      {
        error:
          result.error ??
          result.fieldErrors?.title ??
          result.fieldErrors?.contentMarkdown ??
          "Your post could not be saved.",
        slugError: result.slugError,
      },
      400
    );
  }

  return json({ id: result.postId, ...result.saved }, 201);
};
