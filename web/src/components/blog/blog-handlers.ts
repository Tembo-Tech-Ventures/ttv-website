import { and, eq } from "drizzle-orm";
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
}

function extractPostFormData(formData: FormData) {
  return {
    title: (formData.get("title") as string) || "",
    slug: (formData.get("slug") as string) || "",
    contentMarkdown: (formData.get("contentMarkdown") as string) || "",
    excerpt: (formData.get("excerpt") as string) || undefined,
    coverImageAlt: (formData.get("coverImageAlt") as string) || undefined,
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
  formData: FormData,
  existingPostId?: string,
): Promise<PostFormResult> {
  const data = extractPostFormData(formData);

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

  if (existingPostId) {
    await db
      .update(schema.blogPost)
      .set(values)
      .where(
        and(
          eq(schema.blogPost.id, existingPostId),
          eq(schema.blogPost.profileId, profileId),
        ),
      );
    return { success: true, postId: existingPostId };
  }

  const [inserted] = await db
    .insert(schema.blogPost)
    .values({
      ...values,
      profileId,
      status: "DRAFT",
    })
    .returning({ id: schema.blogPost.id });

  return { success: true, postId: inserted.id };
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

  await db
    .update(schema.blogPost)
    .set({
      status: "PUBLISHED",
      publishedAt: post.publishedAt ?? new Date(),
    })
    .where(
      and(
        eq(schema.blogPost.id, postId),
        eq(schema.blogPost.profileId, profileId),
      ),
    );

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

  await db
    .update(schema.blogPost)
    .set({ status: "DRAFT" })
    .where(
      and(
        eq(schema.blogPost.id, postId),
        eq(schema.blogPost.profileId, profileId),
      ),
    );

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

  await db
    .delete(schema.blogPost)
    .where(
      and(
        eq(schema.blogPost.id, postId),
        eq(schema.blogPost.profileId, profileId),
      ),
    );

  return { success: true };
}
