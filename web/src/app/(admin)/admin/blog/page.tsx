/**
 * page.tsx (admin blog index)
 * ---------------------------
 * Server component that lists all blog posts for administrators. It performs the
 * necessary permission check and then hands rendering over to the PostsClient
 * component for interactivity.
 */

import { checkAdminPermissions } from "@/modules/roles/lib/check-admin-permissions/check-admin-permissions";
import { getPosts } from "@/modules/blog/lib/get-posts/get-posts";
import { PostsClient } from "./posts-client";
import { Stack, Button } from "@mui/material";
import Link from "next/link";

export default async function AdminBlogIndex() {
  await checkAdminPermissions();
  const posts = await getPosts();
  return (
    <Stack spacing={2}>
      <Stack direction="row" spacing={2}>
        <Link href="/admin/blog/new">
          <Button variant="contained">New Post</Button>
        </Link>
      </Stack>
      <PostsClient posts={posts} />
    </Stack>
  );
}
