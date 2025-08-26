/**
 * posts-client.tsx
 * -----------------
 * Client component responsible for rendering the list of existing posts and
 * wiring up delete actions. Editing is handled via standard links to the
 * dedicated edit page. Keeping this component client-side keeps the server
 * component lean and allows interactive deletion without full reloads.
 */

"use client";

import { useTransition } from "react";
import { Button, Stack } from "@mui/material";
import Link from "next/link";
import { deletePost } from "./actions/delete-post";

interface PostSummary {
  title: string;
  slug: string;
}

export function PostsClient({ posts }: { posts: PostSummary[] }) {
  const [isPending, startTransition] = useTransition();

  function handleDelete(slug: string) {
    startTransition(async () => {
      await deletePost(slug);
    });
  }

  return (
    <Stack spacing={2}>
      {posts.map((p) => (
        <Stack key={p.slug} direction="row" spacing={2} alignItems="center">
          <Link href={`/admin/blog/${p.slug}/edit`}>{p.title}</Link>
          <Button
            variant="outlined"
            color="error"
            onClick={() => handleDelete(p.slug)}
            disabled={isPending}
          >
            Delete
          </Button>
        </Stack>
      ))}
      {posts.length === 0 && <div>No posts yet.</div>}
    </Stack>
  );
}
