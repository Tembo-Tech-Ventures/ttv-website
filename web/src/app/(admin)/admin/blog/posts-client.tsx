"use client";

/**
 * posts-client.tsx
 * -----------------
 * Renders the blog post list inside the admin area using MUI's DataGrid. Each
 * row exposes edit and delete actions so administrators can manage the catalog
 * without full page reloads.
 */

import { useTransition } from "react";
import { Button } from "@mui/material";
import { DataGrid, type GridColDef } from "@mui/x-data-grid";
import Link from "next/link";
import { deletePost } from "./actions/delete-post";

interface PostSummary {
  id: string;
  slug: string;
  title: string;
  createdAt: string;
}

export function PostsClient({ posts }: { posts: PostSummary[] }) {
  const [isPending, startTransition] = useTransition();

  function handleDelete(slug: string) {
    startTransition(async () => {
      await deletePost(slug);
    });
  }

  const columns: GridColDef[] = [
    {
      field: "edit",
      headerName: "",
      width: 80,
      renderCell: (params) => (
        <Link href={`/admin/blog/${params.row.slug}/edit`}>Edit</Link>
      ),
    },
    { field: "title", headerName: "Title", flex: 1 },
    { field: "slug", headerName: "Slug", flex: 1 },
    {
      field: "createdAt",
      headerName: "Created",
      width: 150,
      valueGetter: (params) =>
        new Date((params as any).row.createdAt as string).toLocaleDateString(),
    },
    {
      field: "delete",
      headerName: "",
      width: 100,
      renderCell: (params) => (
        <Button
          variant="outlined"
          color="error"
          onClick={() => handleDelete(params.row.slug)}
          disabled={isPending}
        >
          Delete
        </Button>
      ),
    },
  ];

  return (
    <DataGrid
      autoHeight
      disableRowSelectionOnClick
      rows={posts}
      columns={columns}
    />
  );
}
