/**
 * BlogIndex — editorial redesign (PROPOSAL §8).
 *
 * The old layout used the homepage card treatment for every post,
 * which flattened the blog into a card grid. The new treatment reads
 * like a magazine table of contents: oversized Climate Crisis kicker,
 * an editorial subtitle, and a stack of post rows separated only by
 * hairlines — the writing carries the page, not the chrome around it.
 */

import { BlogPostCard } from "./components/blog-post-card/blog-post-card";
import { customColors } from "@/modules/mui/theme/constants";
import { climateCrisis } from "@/modules/mui/theme/fonts";
import { getPosts } from "@/modules/blog/lib/get-posts/get-posts";
import { Box, Container, Stack, Typography } from "@mui/material";

/**
 * Opt into ISR-style revalidation instead of forcing SSR on every request.
 * `force-dynamic` was preventing Cloudflare's static/edge build from
 * emitting a `/blog` route, serving the Astro 404 template instead
 * (PROPOSAL §8). A 5-minute revalidate is plenty for a blog index.
 */
export const revalidate = 300;

export default async function BlogIndex() {
  const posts = await getPosts();

  return (
    <Container component="main" maxWidth="lg" sx={{ py: { xs: 8, md: 14 } }}>
      <Stack spacing={2.5} sx={{ mb: { xs: 6, md: 10 } }}>
        <Typography
          variant="overline"
          sx={{
            color: customColors.orange.main,
            letterSpacing: "0.32em",
            fontSize: { xs: 12, md: 14 },
          }}
        >
          § Field notes
        </Typography>
        <Typography
          component="h1"
          sx={{
            fontFamily: climateCrisis.style.fontFamily,
            fontSize: { xs: "3rem", md: "6rem" },
            lineHeight: 0.95,
            color: customColors.ink.primary,
            letterSpacing: "-0.03em",
          }}
        >
          Notes from
          <br />
          the cohort.
        </Typography>
        <Typography
          variant="h4"
          component="p"
          sx={{
            color: customColors.ink.secondary,
            fontWeight: 500,
            maxWidth: 620,
            fontSize: { xs: "1.15rem", md: "1.35rem" },
          }}
        >
          Founder stories, product learnings, and the principles that guide how
          we train technologists with purpose.
        </Typography>
      </Stack>

      {posts.length > 0 ? (
        <Stack
          divider={<Box sx={{ borderTop: `1px solid ${customColors.rule}` }} />}
        >
          {posts.map((post) => (
            <BlogPostCard key={post.slug} post={post} />
          ))}
        </Stack>
      ) : (
        <Box
          sx={{
            borderTop: `1px solid ${customColors.rule}`,
            borderBottom: `1px solid ${customColors.rule}`,
            py: 10,
            textAlign: "center",
          }}
        >
          <Typography
            variant="h4"
            sx={{ color: customColors.ink.primary, mb: 1 }}
          >
            Posts are on their way.
          </Typography>
          <Typography
            variant="body1"
            sx={{ color: customColors.ink.secondary }}
          >
            Check back soon for fresh thinking from the Tembo Tech Ventures
            team.
          </Typography>
        </Box>
      )}
    </Container>
  );
}
