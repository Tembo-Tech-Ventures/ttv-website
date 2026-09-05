import { and, eq, ne } from "drizzle-orm";
import * as schema from "@/lib/db/schema";
import type { Database } from "@/lib/db/schema";
import { postEditorSchema, deriveExcerpt, estimateReadingMinutes } from "@/lib/blog/post";
import { slugifyTitle, validateSlug, type SlugValidationError } from "@/lib/blog/slug";
import { renderPostHtml, POST_RENDER_VERSION } from "@/lib/blog/render";
import { canTransition, POST_TRANSITIONS } from "@/lib/talent/transitions";

const SLUG_ERROR_MESSAGES: Record<SlugValidationError, string> = {
  too_short: "Slug is required",
  too_long: "Slug must be 80 characters or fewer",
  invalid_chars: "Slug can only contain lowercase letters, numbers, and hyphens",
  double_hyphen: "Slug cannot contain consecutive hyphens",
  reserved: "This slug is reserved",
};

export interface PostFormResult {
  success: boolean;
  postId?: string;
  error?: string;
  slugError?: string;
  fieldErrors?: Record<string, string>;
  /**
   * What was actually stored, for callers that show it back. The editor's
   * autosave uses this so the metadata panel reports the derived slug, excerpt
   * and reading time the server settled on rather than its own guess.
   */
  saved?: {
    slug: string;
    excerpt: string;
    readingMinutes: number;
  };
}

/**
 * The fields a post editor submits. Named separately from `FormData` so the
 * JSON autosave endpoint and the plain `<form>` fallback validate through
 * exactly the same path — two spellings of "save a post" would eventually
 * disagree about something, and it would be the one nobody tested.
 */
export interface PostInput {
  title: string;
  slug: string;
  contentMarkdown: string;
  excerpt?: string;
  coverImageAlt?: string;
}

function str(formData: FormData, name: string): string {
  const v = formData.get(name);
  return typeof v === "string" ? v : "";
}

export function postInputFromFormData(formData: FormData): PostInput {
  return {
    title: str(formData, "title"),
    slug: str(formData, "slug"),
    contentMarkdown: str(formData, "contentMarkdown"),
    excerpt: str(formData, "excerpt") || undefined,
    coverImageAlt: str(formData, "coverImageAlt") || undefined,
  };
}

async function validatePostSlug(
  slug: string,
  profileId: string,
  db: Database,
  currentPostId?: string,
): Promise<{ ok: true; normalized: string } | { ok: false; error: string }> {
  const normalized = slug.trim().toLowerCase();
  const result = validateSlug(normalized);
  if (!result.ok) {
    return { ok: false, error: SLUG_ERROR_MESSAGES[result.error] };
  }

  const existing = await db.query.blogPost.findFirst({
    where: and(
      eq(schema.blogPost.profileId, profileId),
      eq(schema.blogPost.slug, normalized),
    ),
    columns: { id: true },
  });
  if (existing && existing.id !== currentPostId) {
    return { ok: false, error: "You already have a post with this slug" };
  }

  return { ok: true, normalized };
}

export async function savePost(
  db: Database,
  profileId: string,
  data: PostInput,
  existingPostId?: string,
): Promise<PostFormResult> {
  const slug = data.slug || slugifyTitle(data.title);
  const slugResult = await validatePostSlug(slug, profileId, db, existingPostId);
  if (!slugResult.ok) {
    return { success: false, slugError: slugResult.error };
  }

  const parsed = postEditorSchema.safeParse(data);
  if (!parsed.success) {
    const fieldErrors: Record<string, string> = {};
    for (const issue of parsed.error.issues) {
      const path = issue.path.join(".");
      if (!fieldErrors[path]) {
        fieldErrors[path] = issue.message;
      }
    }
    return { success: false, fieldErrors };
  }

  const contentHtml = String(await renderPostHtml(parsed.data.contentMarkdown));
  const readingMinutes = estimateReadingMinutes(parsed.data.contentMarkdown);
  const excerpt = parsed.data.excerpt || deriveExcerpt(parsed.data.contentMarkdown);

  const values = {
    title: parsed.data.title,
    slug: slugResult.normalized,
    contentMarkdown: parsed.data.contentMarkdown,
    contentHtml,
    renderedWith: POST_RENDER_VERSION,
    readingMinutes,
    excerpt,
    coverImageAlt: parsed.data.coverImageAlt ?? null,
  };

  const saved = {
    slug: values.slug,
    excerpt: values.excerpt,
    readingMinutes: values.readingMinutes,
  };

  if (existingPostId) {
    const updated = await db
      .update(schema.blogPost)
      .set(values)
      .where(
        and(
          eq(schema.blogPost.id, existingPostId),
          eq(schema.blogPost.profileId, profileId),
          // A suspended post is read-only. The page hides the editor for one,
          // but the POST handler and the autosave endpoint are reachable
          // without it, and an author who kept typing through a takedown would
          // otherwise keep rewriting the content an admin removed.
          ne(schema.blogPost.status, "SUSPENDED"),
        ),
      )
      .returning({ id: schema.blogPost.id });

    if (updated.length === 0) {
      return { success: false, error: "This post can no longer be edited" };
    }
    return { success: true, postId: existingPostId, saved };
  }

  const [inserted] = await db
    .insert(schema.blogPost)
    .values({
      ...values,
      profileId,
      status: "DRAFT",
    })
    .returning({ id: schema.blogPost.id });

  return { success: true, postId: inserted.id, saved };
}

export async function publishPost(
  db: Database,
  profileId: string,
  postId: string,
): Promise<PostFormResult> {
  const post = await db.query.blogPost.findFirst({
    where: and(
      eq(schema.blogPost.id, postId),
      eq(schema.blogPost.profileId, profileId),
    ),
    columns: { status: true, publishedAt: true },
  });

  if (!post) {
    return { success: false, error: "Post not found" };
  }

  if (!canTransition(POST_TRANSITIONS, post.status, "PUBLISHED")) {
    return { success: false, error: "This post cannot be published from its current status" };
  }

  const result = await db
    .update(schema.blogPost)
    .set({
      status: "PUBLISHED",
      publishedAt: post.publishedAt ?? new Date(),
    })
    .where(
      and(
        eq(schema.blogPost.id, postId),
        eq(schema.blogPost.profileId, profileId),
        eq(schema.blogPost.status, "DRAFT"),
      ),
    );

  if (!result.meta.changes) {
    return { success: false, error: "Post status changed concurrently" };
  }

  return { success: true, postId };
}

export async function unpublishPost(
  db: Database,
  profileId: string,
  postId: string,
): Promise<PostFormResult> {
  const post = await db.query.blogPost.findFirst({
    where: and(
      eq(schema.blogPost.id, postId),
      eq(schema.blogPost.profileId, profileId),
    ),
    columns: { status: true },
  });

  if (!post) {
    return { success: false, error: "Post not found" };
  }

  if (!canTransition(POST_TRANSITIONS, post.status, "DRAFT")) {
    return { success: false, error: "This post cannot be unpublished from its current status" };
  }

  const result = await db
    .update(schema.blogPost)
    .set({ status: "DRAFT" })
    .where(
      and(
        eq(schema.blogPost.id, postId),
        eq(schema.blogPost.profileId, profileId),
        eq(schema.blogPost.status, "PUBLISHED"),
      ),
    );

  if (!result.meta.changes) {
    return { success: false, error: "Post status changed concurrently" };
  }

  return { success: true, postId };
}

export async function deletePost(
  db: Database,
  profileId: string,
  postId: string,
): Promise<PostFormResult> {
  const post = await db.query.blogPost.findFirst({
    where: and(
      eq(schema.blogPost.id, postId),
      eq(schema.blogPost.profileId, profileId),
    ),
    columns: { status: true },
  });

  if (!post) {
    return { success: false, error: "Post not found" };
  }

  if (post.status !== "DRAFT") {
    return { success: false, error: "Only draft posts can be deleted" };
  }

  const result = await db
    .delete(schema.blogPost)
    .where(
      and(
        eq(schema.blogPost.id, postId),
        eq(schema.blogPost.profileId, profileId),
        eq(schema.blogPost.status, "DRAFT"),
      ),
    );

  if (!result.meta.changes) {
    return { success: false, error: "Post status changed concurrently" };
  }

  return { success: true };
}

/**
 * The actions a post editor form can ask for.
 *
 * `publish` and `unpublish` save first. The editor's forms carry the whole
 * draft rather than an id, so pressing Publish cannot publish a copy of the
 * post that is one autosave behind what is on screen.
 */
export type PostAction = "save" | "publish" | "unpublish" | "delete";

const POST_ACTIONS = new Set<PostAction>([
  "save",
  "publish",
  "unpublish",
  "delete",
]);

export function parsePostAction(value: unknown): PostAction {
  return typeof value === "string" && POST_ACTIONS.has(value as PostAction)
    ? (value as PostAction)
    : "save";
}

export interface PostActionOutcome {
  result: PostFormResult;
  /** Where to send the browser next, if the action changed which page applies. */
  redirectTo?: string;
}

export async function handlePostAction(
  db: Database,
  profileId: string,
  formData: FormData,
  existingPostId?: string,
): Promise<PostActionOutcome> {
  const action = parsePostAction(formData.get("_action"));

  if (action === "delete") {
    if (!existingPostId) {
      return { result: { success: false, error: "Post not found" } };
    }
    const result = await deletePost(db, profileId, existingPostId);
    return result.success
      ? { result, redirectTo: "/dashboard/writing" }
      : { result };
  }

  const saved = await savePost(
    db,
    profileId,
    postInputFromFormData(formData),
    existingPostId,
  );
  if (!saved.success || !saved.postId) return { result: saved };

  if (action === "save") {
    // A post that has just been created lives at a different URL than the one
    // the form was submitted to, and leaving the browser on /new would make the
    // next save create a second post.
    return existingPostId
      ? { result: saved }
      : { result: saved, redirectTo: `/dashboard/writing/${saved.postId}` };
  }

  const transitioned =
    action === "publish"
      ? await publishPost(db, profileId, saved.postId)
      : await unpublishPost(db, profileId, saved.postId);

  return transitioned.success
    ? { result: transitioned, redirectTo: `/dashboard/writing/${saved.postId}` }
    : { result: transitioned };
}
