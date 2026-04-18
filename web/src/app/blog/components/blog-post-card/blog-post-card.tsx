/**
 * BlogPostCard — editorial row (PROPOSAL §8).
 *
 * Each post is now a full-width row in the index rather than a small
 * card on a grid. Readers see an oversized Climate Crisis title (the
 * thing they came for), a pub date kicker, and a tight excerpt. The
 * row is a single clickable surface with a subtle hover tint so
 * keyboard and pointer users get the same affordance.
 */

import { Link } from "@/components/link/link";
import type { BlogPost } from "@/modules/blog/lib/get-posts/get-posts";
import { customColors } from "@/modules/mui/theme/constants";
import { climateCrisis } from "@/modules/mui/theme/fonts";
import { Box, Stack, Typography } from "@mui/material";

const PUBLISH_DATE_FORMATTER = new Intl.DateTimeFormat("en-US", {
  dateStyle: "long",
});

const EXCERPT_MAX_LENGTH = 220;

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
        sx: {
          display: "block",
          py: { xs: 4, md: 6 },
          transition: "background-color 200ms ease",
          "&:hover": {
            backgroundColor: "rgba(242,141,104,0.04)",
          },
        },
      }}
    >
      <Stack
        direction={{ xs: "column", md: "row" }}
        spacing={{ xs: 2, md: 8 }}
        alignItems={{ xs: "flex-start", md: "baseline" }}
      >
        <Box sx={{ flex: "0 0 auto", minWidth: { md: 180 } }}>
          <Typography
            variant="overline"
            sx={{
              color: customColors.ink.secondary,
              letterSpacing: "0.24em",
              fontSize: 11,
            }}
          >
            {publishedOn}
          </Typography>
        </Box>
        <Stack spacing={2} sx={{ flex: "1 1 auto" }}>
          <Typography
            component="h2"
            sx={{
              fontFamily: climateCrisis.style.fontFamily,
              fontSize: { xs: "2rem", md: "3rem" },
              lineHeight: 1.05,
              color: customColors.ink.primary,
              letterSpacing: "-0.02em",
            }}
          >
            {post.title}
          </Typography>
          <Typography
            variant="body1"
            sx={{ color: customColors.ink.secondary, maxWidth: 680 }}
          >
            {excerpt}
          </Typography>
          <Typography
            variant="button"
            sx={{
              color: customColors.orange.main,
              fontWeight: 700,
              letterSpacing: "0.12em",
            }}
          >
            Read story →
          </Typography>
        </Stack>
      </Stack>
    </Link>
  );
}
