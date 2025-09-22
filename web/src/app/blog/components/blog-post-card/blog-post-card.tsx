/**
 * BlogPostCard
 * ------------
 * Presentational helper that renders a teaser for a single blog entry. The
 * component now leans on the shared `<Card>` surface that already ships on the
 * homepage, which keeps the visual language consistent while avoiding bespoke
 * gradient styling.
 *
 * Responsibilities:
 * - Format the publication date into a human-readable string using
 *   `Intl.DateTimeFormat` so localisation can be extended easily.
 * - Generate a concise excerpt from the markdown body to entice readers without
 *   overwhelming the list view.
 * - Wrap the entire surface in the shared `<Link>` component so hover and focus
 *   states match other navigational affordances on the site.
 */

import { Card } from "@/components/card/card";
import { Link } from "@/components/link/link";
import type { BlogPost } from "@/modules/blog/lib/get-posts/get-posts";
import { Stack, Typography } from "@mui/material";

const PUBLISH_DATE_FORMATTER = new Intl.DateTimeFormat("en-US", {
  dateStyle: "long",
});

const EXCERPT_MAX_LENGTH = 180;

/**
 * Creates a short teaser paragraph by stripping common markdown syntax and
 * trimming the copy to a fixed length. Keeping the logic co-located with the
 * card keeps the parent index component focused on layout concerns.
 */
function createExcerpt(markdown: string): string {
  const withoutMarkdown = markdown
    .replace(/[#*_`>~\-]+/g, " ")
    .replace(/\[([^\]]+)\]\([^\)]+\)/g, "$1")
    .replace(/\s+/g, " ")
    .trim();
  if (withoutMarkdown.length <= EXCERPT_MAX_LENGTH) {
    return withoutMarkdown;
  }
  return `${withoutMarkdown.slice(0, EXCERPT_MAX_LENGTH).trimEnd()}…`;
}

interface BlogPostCardProps {
  post: BlogPost;
}

export function BlogPostCard({ post }: BlogPostCardProps) {
  const publishedOn = PUBLISH_DATE_FORMATTER.format(post.createdAt);
  const excerpt = createExcerpt(post.content);

  return (
    <Link
      href={`/blog/${post.slug}`}
      muiLinkProps={{
        underline: "none",
        sx: { display: "block", height: "100%" },
      }}
    >
      <Card component="article" style={{ height: "100%" }}>
        <Stack spacing={2} sx={{ height: "100%" }}>
          <Typography variant="overline" color="text.secondary">
            {publishedOn}
          </Typography>
          <Typography variant="h5" component="h2" fontWeight={600}>
            {post.title}
          </Typography>
          <Typography variant="body1" color="text.secondary">
            {excerpt}
          </Typography>
          <Typography
            variant="button"
            sx={{
              mt: "auto",
              alignSelf: "flex-start",
              color: "primary.main",
              fontWeight: 600,
              letterSpacing: 1,
            }}
          >
            Read story →
          </Typography>
        </Stack>
      </Card>
    </Link>
  );
}
