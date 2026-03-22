/**
 * BlogIndex
 * ---------
 * Server-rendered landing page for the public blog experience. The goal of the
 * latest iteration is to reuse the same card treatment that appears on the
 * homepage while removing the heavy gradient shells that previously framed the
 * layout. Doing so keeps the focus on the writing rather than the chrome
 * surrounding it.
 *
 * Implementation notes:
 * - The hero copy is rendered directly on the page background without an
 *   additional container so that the typography stands alone, per the design
 *   direction.
 * - Each post preview reuses the shared `<Card>` component from the homepage to
 *   maintain a consistent surface treatment.
 * - Empty states still communicate clearly, but now rely on the same card
 *   styling to avoid bespoke gradient shells.
 */

import { BlogPostCard } from "./components/blog-post-card/blog-post-card";
import { Card } from "@/components/card/card";
import { getPosts } from "@/modules/blog/lib/get-posts/get-posts";
import { Container, Stack, Typography } from "@mui/material";
import Grid from "@mui/material/Grid";

export const dynamic = "force-dynamic";

export default async function BlogIndex() {
  const posts = await getPosts();

  return (
    <Stack
      component="main"
      sx={{
        minHeight: "100vh",
        bgcolor: "background.default",
        py: { xs: 6, md: 10 },
      }}
    >
      <Container maxWidth="lg">
        <Stack spacing={1.5} textAlign={{ xs: "center", md: "left" }}>
          <Typography component="h1" variant="h3" fontWeight={700}>
            Insights from Tembo Tech Ventures
          </Typography>
          <Typography
            variant="h6"
            sx={{ maxWidth: 640, mx: { xs: "auto", md: 0 } }}
          >
            Explore founder stories, product learnings, and the principles that
            guide how we build technology with purpose.
          </Typography>
        </Stack>

        {posts.length > 0 ? (
          <Grid
            container
            spacing={{ xs: 3, md: 4 }}
            sx={{ mt: { xs: 4, md: 6 } }}
          >
            {posts.map((post) => (
              <Grid key={post.slug} size={{ xs: 12, md: 6 }}>
                <BlogPostCard post={post} />
              </Grid>
            ))}
          </Grid>
        ) : (
          <Stack sx={{ mt: { xs: 4, md: 6 } }}>
            <Card component="section" style={{ textAlign: "center" }}>
              <Typography variant="h5" fontWeight={600} gutterBottom>
                Posts are on their way
              </Typography>
              <Typography variant="body1" color="text.secondary">
                Check back soon for fresh thinking from the Tembo Tech Ventures
                team.
              </Typography>
            </Card>
          </Stack>
        )}
      </Container>
    </Stack>
  );
}
