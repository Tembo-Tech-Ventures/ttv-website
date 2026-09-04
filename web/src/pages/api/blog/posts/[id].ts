/**
 * Autosave for a post that already exists.
 *
 * `savePost` scopes its update to the author's own profile and refuses a
 * suspended post, so an id from someone else's account matches no row and comes
 * back as a failure rather than a silent write.
 */
import type { APIRoute } from "astro";
import { savePost } from "@/components/blog/blog-handlers";
import { json, readPostBody, resolveAuthor } from "@/lib/blog/api";

export const PUT: APIRoute = async ({ params, request }) => {
  const id = params.id;
  if (!id) return json({ error: "Post not found" }, 404);

  const author = await resolveAuthor(request);
  if (author instanceof Response) return author;

  const input = await readPostBody(request);
  if (input instanceof Response) return input;

  const result = await savePost(author.db, author.profileId, input, id);
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

  return json({ id: result.postId, ...result.saved });
};
