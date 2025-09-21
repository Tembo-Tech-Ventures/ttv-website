/**
 * BlogPost
 * --------
 * Server-rendered detail view for a single blog entry. The layout intentionally
 * mirrors the homepage card treatment for the header while letting the article
 * body sit directly on the page background. This keeps the writing front-and-
 * centre without heavy gradients or drop shadows.
 *
 * Key behaviours:
 * - Formats the publication timestamp for humans using `Intl.DateTimeFormat`.
 * - Provides bespoke Markdown component overrides so headings, paragraphs, and
 *   lists inherit the site's typography system.
 * - Shares the same `<Card>` surface from the homepage for the title/date block
 *   while keeping the article content container-free.
 */

import { Card } from "@/components/card/card";
import { Link } from "@/components/link/link";
import { getPost } from "@/modules/blog/lib/get-post/get-post";
import { customColors } from "@/modules/mui/theme/constants";
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
      color="text.primary"
      sx={{ mt: 4, mb: 1.5 }}
    >
      {children}
    </Typography>
  ),
  p: ({ children }) => (
    <Typography
      variant="body1"
      paragraph
      sx={{ color: "text.secondary", lineHeight: 1.7 }}
    >
      {children}
    </Typography>
  ),
  strong: ({ children }) => (
    <Box component="strong" sx={{ fontWeight: 700, color: "text.primary" }}>
      {children}
    </Box>
  ),
  em: ({ children }) => (
    <Box component="em" sx={{ fontStyle: "italic", color: "text.secondary" }}>
      {children}
    </Box>
  ),
  ul: ({ children }) => (
    <Box
      component="ul"
      sx={{
        pl: 3,
        my: 2,
        color: "text.secondary",
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
        color: "text.secondary",
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
      sx={{ mb: 1, color: "text.secondary" }}
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
          backgroundColor: "rgba(255,255,255,0.05)",
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
        color: "text.secondary",
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
          bgcolor: "background.default",
          py: { xs: 6, md: 10 },
        }}
      >
        <Container maxWidth="sm">
          <Card component="section" style={{ textAlign: "center" }}>
            <Typography variant="h4" fontWeight={700} gutterBottom>
              We couldn’t find that story.
            </Typography>
            <Typography variant="body1" color="text.secondary" gutterBottom>
              The post may have been moved or removed. Explore the latest
              insights from our team instead.
            </Typography>
            <Link
              href="/blog"
              muiLinkProps={{
                underline: "hover",
                sx: { color: "primary.main", fontWeight: 600 },
              }}
            >
              Browse all posts
            </Link>
          </Card>
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
        bgcolor: "background.default",
        py: { xs: 6, md: 10 },
      }}
    >
      <Container maxWidth="md">
        <Link
          href="/blog"
          muiLinkProps={{
            underline: "hover",
            sx: {
              color: "text.secondary",
              fontWeight: 600,
              letterSpacing: 0.5,
            },
          }}
        >
          ← Back to all posts
        </Link>
        <Box mt={3}>
          <Card component="header">
            <Typography
              component="h1"
              variant="h3"
              fontWeight={700}
              gutterBottom
            >
              {post.title}
            </Typography>
            <Typography variant="subtitle1" color="text.secondary">
              {publishedOn}
            </Typography>
          </Card>
        </Box>
        <Box mt={4}>
          <Markdown components={markdownComponents}>{post.content}</Markdown>
        </Box>
      </Container>
    </Stack>
  );
}
