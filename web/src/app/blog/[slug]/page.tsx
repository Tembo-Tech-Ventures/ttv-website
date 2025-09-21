/**
 * BlogPost
 * --------
 * Renders the detailed view for a single blog entry using the same gradient
 * language and typography scale as the marketing homepage. The component stays
 * server-rendered to keep Prisma queries on the backend while providing rich
 * presentation for the markdown content.
 *
 * Key behaviours:
 * - Formats the publication timestamp for humans using `Intl.DateTimeFormat`.
 * - Provides bespoke Markdown component overrides so headings, paragraphs, and
 *   lists inherit the site's typography system.
 * - Wraps the layout in a gradient shell with generous spacing for comfortable
 *   reading on both mobile and desktop breakpoints.
 */

import { Link } from "@/components/link/link";
import { getPost } from "@/modules/blog/lib/get-post/get-post";
import { customColors, getShadow } from "@/modules/mui/theme/constants";
import { Box, Container, Stack, Typography } from "@mui/material";
import type { ReactNode } from "react";
import type { Components } from "react-markdown";
import Markdown from "react-markdown";

export const dynamic = "force-dynamic";

interface Params {
  params: { slug: string };
}

const PUBLISH_DATE_FORMATTER = new Intl.DateTimeFormat("en-US", {
  dateStyle: "long",
});

const markdownComponents: Components = {
  h2: ({ children }) => (
    <Typography
      component="h2"
      variant="h4"
      fontWeight={700}
      color={customColors.orange.main}
      sx={{ mt: 6, mb: 2 }}
    >
      {children}
    </Typography>
  ),
  h3: ({ children }) => (
    <Typography
      component="h3"
      variant="h5"
      fontWeight={600}
      color="white"
      sx={{ mt: 4, mb: 1.5 }}
    >
      {children}
    </Typography>
  ),
  p: ({ children }) => (
    <Typography
      variant="body1"
      paragraph
      sx={{ color: "rgba(255,255,255,0.85)", lineHeight: 1.7 }}
    >
      {children}
    </Typography>
  ),
  strong: ({ children }) => (
    <Box component="strong" sx={{ fontWeight: 700, color: "white" }}>
      {children}
    </Box>
  ),
  em: ({ children }) => (
    <Box
      component="em"
      sx={{ fontStyle: "italic", color: "rgba(255,255,255,0.85)" }}
    >
      {children}
    </Box>
  ),
  ul: ({ children }) => (
    <Box
      component="ul"
      sx={{
        pl: 3,
        my: 2,
        color: "rgba(255,255,255,0.85)",
        listStyle: "disc",
      }}
    >
      {children}
    </Box>
  ),
  ol: ({ children }) => (
    <Box
      component="ol"
      sx={{
        pl: 3,
        my: 2,
        color: "rgba(255,255,255,0.85)",
        listStyle: "decimal",
      }}
    >
      {children}
    </Box>
  ),
  li: ({ children }) => (
    <Typography
      component="li"
      variant="body1"
      sx={{ mb: 1, color: "rgba(255,255,255,0.85)" }}
    >
      {children}
    </Typography>
  ),
  code: (props) => {
    const { inline = false, children } = props as {
      inline?: boolean;
      children: ReactNode;
    };

    return (
      <Box
        component="code"
        sx={{
          display: inline ? "inline" : "block",
          backgroundColor: "rgba(0,0,0,0.35)",
          borderRadius: 2,
          px: 1.5,
          py: inline ? 0.5 : 1,
          fontFamily: "'Fira Code', 'Courier New', monospace",
          fontSize: "0.95rem",
          color: customColors.orange.main,
          my: inline ? 0 : 2,
          whiteSpace: inline ? "pre-wrap" : "pre",
        }}
      >
        {children}
      </Box>
    );
  },
  a: ({ href, children }) => (
    <Link
      href={href ?? "#"}
      muiLinkProps={{
        underline: "hover",
        sx: { color: customColors.orange.main, fontWeight: 600 },
      }}
    >
      {children}
    </Link>
  ),
  blockquote: ({ children }) => (
    <Box
      component="blockquote"
      sx={{
        borderLeft: `4px solid ${customColors.orange.main}`,
        pl: 3,
        my: 3,
        color: "rgba(255,255,255,0.85)",
        fontStyle: "italic",
      }}
    >
      {children}
    </Box>
  ),
};

export default async function BlogPost({ params }: Params) {
  const post = await getPost(params.slug);

  if (!post) {
    return (
      <Stack
        component="main"
        sx={{
          minHeight: "100vh",
          backgroundColor: customColors.dark.main,
          backgroundImage: `linear-gradient(180deg, ${customColors.dark.main}, ${customColors.lessDark.main})`,
          py: { xs: 6, md: 10 },
        }}
      >
        <Container maxWidth="sm">
          <Box
            sx={{
              borderRadius: 4,
              p: { xs: 4, md: 5 },
              textAlign: "center",
              backgroundColor: "rgba(1, 61, 57, 0.75)",
              boxShadow: getShadow("md"),
              color: "white",
            }}
          >
            <Typography variant="h4" fontWeight={700} gutterBottom>
              We couldn’t find that story.
            </Typography>
            <Typography
              variant="body1"
              sx={{ color: "rgba(255,255,255,0.8)" }}
              gutterBottom
            >
              The post may have been moved or removed. Explore the latest
              insights from our team instead.
            </Typography>
            <Link
              href="/blog"
              muiLinkProps={{
                underline: "none",
                sx: {
                  display: "inline-block",
                  mt: 3,
                  px: 3,
                  py: 1.5,
                  borderRadius: 999,
                  backgroundImage: `linear-gradient(135deg, ${customColors.lessDark.main}, ${customColors.orange.main})`,
                  color: "white",
                  fontWeight: 600,
                },
              }}
            >
              Browse all posts
            </Link>
          </Box>
        </Container>
      </Stack>
    );
  }

  const publishedOn = PUBLISH_DATE_FORMATTER.format(post.createdAt);

  return (
    <Stack
      component="main"
      sx={{
        minHeight: "100vh",
        backgroundColor: customColors.dark.main,
        backgroundImage: `linear-gradient(180deg, ${customColors.dark.main}, ${customColors.lessDark.main})`,
        py: { xs: 6, md: 10 },
      }}
    >
      <Container maxWidth="md">
        <Link
          href="/blog"
          muiLinkProps={{
            underline: "hover",
            sx: {
              color: "rgba(255,255,255,0.75)",
              fontWeight: 600,
              letterSpacing: 0.5,
            },
          }}
        >
          ← Back to all posts
        </Link>
        <Box
          sx={{
            mt: 3,
            backgroundImage: `linear-gradient(135deg, ${customColors.lessDark.main}, ${customColors.orange.main})`,
            borderRadius: 5,
            p: { xs: 4, md: 5 },
            boxShadow: getShadow("lg"),
            color: "white",
          }}
        >
          <Typography component="h1" variant="h3" fontWeight={700} gutterBottom>
            {post.title}
          </Typography>
          <Typography
            variant="subtitle1"
            sx={{ color: "rgba(255,255,255,0.85)" }}
          >
            {publishedOn}
          </Typography>
        </Box>
        <Box
          sx={{
            mt: 4,
            borderRadius: 4,
            backgroundColor: "rgba(1, 61, 57, 0.85)",
            boxShadow: getShadow("md"),
            p: { xs: 3, md: 5 },
          }}
        >
          <Markdown components={markdownComponents}>{post.content}</Markdown>
        </Box>
      </Container>
    </Stack>
  );
}
