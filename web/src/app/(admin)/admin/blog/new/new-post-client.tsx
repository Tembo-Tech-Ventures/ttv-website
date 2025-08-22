/**
 * Client component providing the markdown editor for creating posts.
 * The actual persistence happens via the `createPost` server action which is
 * invoked from within this component. Keeping the client purely focused on
 * collecting user input ensures we can later reuse the action elsewhere.
 */

"use client";

import dynamic from "next/dynamic";
import { useState, useTransition } from "react";
import { Stack, Button, TextField } from "@mui/material";
import { createPost } from "./actions/create-post";

const MDEditor = dynamic(() => import("@uiw/react-md-editor"), { ssr: false });

export function NewPostClient() {
  const [title, setTitle] = useState("");
  const [value, setValue] = useState<string | undefined>(
    "### Write something awesome\n",
  );

  const [isPending, startTransition] = useTransition();

  function save() {
    if (!title || !value) return;
    startTransition(async () => {
      await createPost({ title, content: value });
      setTitle("");
      setValue("### Write something awesome\n");
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
        {isPending ? "Saving..." : "Publish"}
      </Button>
    </Stack>
  );
}
