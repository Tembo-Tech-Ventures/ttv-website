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
import { Stack, Button, Typography } from "@mui/material";
import NextLink from "next/link";

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
    <Stack spacing={3}>
      <Stack
        direction="row"
        spacing={2}
        alignItems="center"
        justifyContent="space-between"
      >
        <Typography variant="h4" component="h1">
          Blog Posts
        </Typography>
        <Button variant="contained" component={NextLink} href="/admin/blog/new">
          New Post
        </Button>
      </Stack>
      <PostsClient posts={serializedPosts} />
    </Stack>
  );
}
