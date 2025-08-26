/**
 * edit-post-client.tsx
 * ---------------------
 * Client component powering the blog post editor used for updates. It mirrors
 * the new post editor but initializes state from the existing post and invokes
 * the updatePost server action when saving.
 */

"use client";

import dynamic from "next/dynamic";
import { useState, useTransition } from "react";
import { Stack, Button, TextField } from "@mui/material";
import { updatePost } from "./actions/update-post";

const MDEditor = dynamic(() => import("@uiw/react-md-editor"), { ssr: false });

export function EditPostClient({
  initialTitle,
  initialContent,
  slug,
}: {
  initialTitle: string;
  initialContent: string;
  slug: string;
}) {
  const [title, setTitle] = useState(initialTitle);
  const [value, setValue] = useState<string | undefined>(initialContent);
  const [isPending, startTransition] = useTransition();

  function save() {
    if (!title || !value) return;
    startTransition(async () => {
      await updatePost({ slug, title, content: value });
    });
  }

  return (
    <Stack spacing={2}>
      <TextField
        label="Title"
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        fullWidth
      />
      <MDEditor value={value} onChange={setValue} previewOptions={{}} />
      <Button
        variant="contained"
        onClick={save}
        disabled={!title || !value || isPending}
      >
        {isPending ? "Saving..." : "Save"}
      </Button>
    </Stack>
  );
}
