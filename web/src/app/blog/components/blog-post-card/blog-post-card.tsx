/**
 * BlogPostCard
 * ------------
 * Presentational helper that renders a teaser for a single blog entry. The
 * card embraces Tembo's gradient surfaces and rounded edges while remaining
 * lightweight enough to render server-side inside the blog index route.
 *
 * Responsibilities:
 * - Format the publication date into a human-readable string using
 *   `Intl.DateTimeFormat` so localisation can be extended easily.
 * - Generate a concise excerpt from the markdown body to entice readers without
 *   overwhelming the list view.
 * - Wrap the entire surface in the shared `<Link>` component so hover and focus
 *   states match other navigational affordances on the site.
 */

import { Link } from "@/components/link/link";
import type { BlogPost } from "@/modules/blog/lib/get-posts/get-posts";
import { customColors, getShadow } from "@/modules/mui/theme/constants";
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
        sx: { display: "block", borderRadius: 4 },
      }}
    >
      <Stack
        spacing={2}
        sx={{
          height: "100%",
          borderRadius: 4,
          backgroundImage: `linear-gradient(150deg, rgba(255,255,255,0.08), rgba(242,141,104,0.25))`,
          backgroundColor: "rgba(1, 61, 57, 0.75)",
          color: "white",
          p: 4,
          boxShadow: getShadow("md"),
          transition: "transform 150ms ease, box-shadow 150ms ease",
          "&:hover": {
            transform: "translateY(-6px)",
            boxShadow: getShadow("lg"),
          },
          "&:focus-within": {
            transform: "translateY(-6px)",
            boxShadow: getShadow("lg"),
          },
        }}
      >
        <Typography variant="overline" sx={{ color: "rgba(255,255,255,0.75)" }}>
          {publishedOn}
        </Typography>
        <Typography variant="h5" component="h2" fontWeight={600}>
          {post.title}
        </Typography>
        <Typography variant="body1" sx={{ color: "rgba(255,255,255,0.82)" }}>
          {excerpt}
        </Typography>
        <Typography
          variant="button"
          sx={{
            mt: "auto",
            alignSelf: "flex-start",
            color: customColors.orange.main,
            fontWeight: 600,
            letterSpacing: 1,
          }}
        >
          Read story →
        </Typography>
      </Stack>
    </Link>
  );
}
