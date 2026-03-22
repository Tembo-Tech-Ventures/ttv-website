/**
 * page.tsx (admin blog edit)
 * --------------------------
 * Server component used to edit an existing blog post. It verifies access
 * rights, loads the post by slug and renders the client-side editor.
 */

import { checkAdminPermissions } from "@/modules/roles/lib/check-admin-permissions/check-admin-permissions";
import { getPost } from "@/modules/blog/lib/get-post/get-post";
import { EditPostClient } from "./edit-post-client";
import { notFound } from "next/navigation";

export default async function EditPostPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  await checkAdminPermissions();
  const { slug } = await params;
  const post = await getPost(slug);
  if (!post) {
    notFound();
  }
  return (
    <EditPostClient
      slug={post.slug}
      initialTitle={post.title}
      initialContent={post.content}
    />
  );
}
