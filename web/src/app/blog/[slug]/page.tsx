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

import { Link } from "@/components/link/link";
import { getPost } from "@/modules/blog/lib/get-post/get-post";
import { customColors } from "@/modules/mui/theme/constants";
import { climateCrisis } from "@/modules/mui/theme/fonts";
import { Box, Container, Stack, Typography } from "@mui/material";
import type { ReactNode } from "react";
import type { Components } from "react-markdown";
import Markdown from "react-markdown";

/**
 * See `/blog/page.tsx` — use ISR revalidation to make the blog entry
 * routes compatible with the Cloudflare build rather than forcing every
 * request through SSR.
 */
export const revalidate = 300;

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
      <Container
        component="main"
        maxWidth="sm"
        sx={{ py: { xs: 8, md: 14 }, textAlign: "center" }}
      >
        <Typography
          component="h1"
          sx={{
            fontFamily: climateCrisis.style.fontFamily,
            fontSize: { xs: "2.5rem", md: "4rem" },
            color: customColors.ink.primary,
            letterSpacing: "-0.02em",
            mb: 2,
          }}
        >
          We couldn&rsquo;t find that story.
        </Typography>
        <Typography
          variant="body1"
          sx={{ color: customColors.ink.secondary, mb: 3 }}
        >
          The post may have been moved or removed. Explore the latest insights
          from our team instead.
        </Typography>
        <Link
          href="/blog"
          muiLinkProps={{
            underline: "hover",
            sx: { color: "primary.main", fontWeight: 600 },
          }}
        >
          ← Browse all posts
        </Link>
      </Container>
    );
  }

  const publishedOn = PUBLISH_DATE_FORMATTER.format(post.createdAt);

  return (
    <Container component="main" maxWidth="md" sx={{ py: { xs: 6, md: 10 } }}>
      <Link
        href="/blog"
        muiLinkProps={{
          underline: "hover",
          sx: {
            color: customColors.ink.secondary,
            fontWeight: 500,
            letterSpacing: "0.1em",
            textTransform: "uppercase",
            fontSize: 12,
          },
        }}
      >
        ← Back to all posts
      </Link>
      <Stack spacing={2} sx={{ mt: 4, mb: 6 }}>
        <Typography
          variant="overline"
          sx={{ color: customColors.orange.main, letterSpacing: "0.24em" }}
        >
          {publishedOn}
        </Typography>
        <Typography
          component="h1"
          sx={{
            fontFamily: climateCrisis.style.fontFamily,
            fontSize: { xs: "2.5rem", md: "4.5rem" },
            lineHeight: 1.02,
            color: customColors.ink.primary,
            letterSpacing: "-0.02em",
          }}
        >
          {post.title}
        </Typography>
      </Stack>
      <Box sx={{ borderTop: `1px solid ${customColors.rule}`, pt: 4 }}>
        <Markdown components={markdownComponents}>{post.content}</Markdown>
      </Box>
    </Container>
  );
}
