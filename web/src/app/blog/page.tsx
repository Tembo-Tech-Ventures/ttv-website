/**
 * BlogIndex
 * ---------
 * Public-facing blog landing page that mirrors the expressive gradients and
 * rounded surfaces used across the marketing site. The component keeps the
 * server-rendered data fetching behaviour (`force-dynamic`) while layering a
 * visually rich hero banner and a responsive grid of teaser cards.
 *
 * Implementation notes:
 * - The surrounding `<Stack>` paints the familiar dark-to-teal gradient so the
 *   blog feels cohesive with the rest of the brand experiences.
 * - A hero callout introduces the blog with warm tones and subtle shadowing to
 *   echo the homepage hero.
 * - Individual posts are rendered via `BlogPostCard`, which is responsible for
 *   truncating copy and formatting dates so the list remains scannable.
 * - Empty states are handled gracefully with a styled panel that still honours
 *   the theme palette.
 */

import { BlogPostCard } from "./components/blog-post-card/blog-post-card";
import { getPosts } from "@/modules/blog/lib/get-posts/get-posts";
import { customColors, getShadow } from "@/modules/mui/theme/constants";
import { Box, Container, Grid, Stack, Typography } from "@mui/material";

export const dynamic = "force-dynamic";

export default async function BlogIndex() {
  const posts = await getPosts();

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
      <Container maxWidth="lg">
        <Box
          sx={{
            backgroundImage: `linear-gradient(135deg, ${customColors.lessDark.main}, ${customColors.orange.main})`,
            borderRadius: 6,
            p: { xs: 4, md: 6 },
            boxShadow: getShadow("lg"),
            color: "white",
            textAlign: { xs: "center", md: "left" },
          }}
        >
          <Typography component="h1" variant="h3" fontWeight={700} gutterBottom>
            Insights from Tembo Tech Ventures
          </Typography>
          <Typography
            variant="h6"
            sx={{ maxWidth: 640, mx: { xs: "auto", md: 0 } }}
          >
            Explore founder stories, product learnings, and the principles that
            guide how we build technology with purpose.
          </Typography>
        </Box>

        {posts.length > 0 ? (
          <Grid container spacing={{ xs: 3, md: 4 }} mt={{ xs: 4, md: 6 }}>
            {posts.map((post) => (
              <Grid key={post.slug} item xs={12} md={6}>
                <BlogPostCard post={post} />
              </Grid>
            ))}
          </Grid>
        ) : (
          <Box
            sx={{
              mt: 6,
              borderRadius: 4,
              backgroundColor: "rgba(1, 61, 57, 0.65)",
              border: `1px solid rgba(242, 141, 104, 0.35)`,
              p: { xs: 4, md: 6 },
              color: "white",
              textAlign: "center",
              boxShadow: getShadow("md"),
            }}
          >
            <Typography variant="h5" fontWeight={600} gutterBottom>
              Posts are on their way
            </Typography>
            <Typography variant="body1" color="rgba(255, 255, 255, 0.75)">
              Check back soon for fresh thinking from the Tembo Tech Ventures
              team.
            </Typography>
          </Box>
        )}
      </Container>
    </Stack>
  );
}
