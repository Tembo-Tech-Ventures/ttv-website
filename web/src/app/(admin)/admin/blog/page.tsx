/**
 * page.tsx (admin blog index)
 * ---------------------------
 * Server component that lists all blog posts for administrators. It performs
 * the mandatory permission check, loads the posts from the database and
 * serializes the relevant metadata so the client-side data grid can present a
 * full management interface (view, edit and delete).
 */

import { checkAdminPermissions } from "@/modules/roles/lib/check-admin-permissions/check-admin-permissions";
import { getPosts } from "@/modules/blog/lib/get-posts/get-posts";
import { PostsClient, type AdminPostRow } from "./posts-client";
import { Box, Button, Container, Stack, Typography } from "@mui/material";
import NextLink from "next/link";
import { customColors, getShadow } from "@/modules/mui/theme/constants";

export default async function AdminBlogIndex() {
  await checkAdminPermissions();
  const posts = await getPosts();
  const serializedPosts: AdminPostRow[] = posts.map((post) => ({
    id: post.id,
    title: post.title,
    slug: post.slug,
    createdAt: post.createdAt.toISOString(),
    updatedAt: post.updatedAt.toISOString(),
  }));

  return (
    <Container maxWidth="lg" sx={{ py: 4 }}>
      <Stack spacing={4}>
        <Box
          sx={{
            backgroundImage: `linear-gradient(135deg, ${customColors.lessDark.main}, ${customColors.orange.main})`,
            borderRadius: 4,
            boxShadow: getShadow("lg"),
            color: "common.white",
            px: { xs: 3, md: 5 },
            py: { xs: 4, md: 5 },
            display: "flex",
            flexDirection: { xs: "column", md: "row" },
            alignItems: { xs: "flex-start", md: "center" },
            justifyContent: "space-between",
            gap: { xs: 3, md: 4 },
          }}
        >
          <Stack spacing={1} sx={{ maxWidth: { md: "60%" } }}>
            <Typography variant="h3" component="h1" color="inherit">
              Blog Posts
            </Typography>
            <Typography variant="body1" color="rgba(255,255,255,0.85)">
              Curate the stories that welcome visitors to Tembo Tech Ventures.
              Publish updates, refine messaging, and keep our community engaged
              with the latest wins.
            </Typography>
          </Stack>
          <Button
            variant="contained"
            component={NextLink}
            href="/admin/blog/new"
            sx={{
              alignSelf: { xs: "stretch", md: "center" },
              backgroundColor: "common.white",
              color: customColors.dark.main,
              fontWeight: 600,
              px: { xs: 3, md: 4 },
              py: 1.5,
              borderRadius: 999,
              "&:hover": {
                backgroundColor: "grey.100",
              },
            }}
          >
            New Post
          </Button>
        </Box>
        <PostsClient posts={serializedPosts} />
      </Stack>
    </Container>
  );
}
