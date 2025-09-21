/**
 * posts-client.tsx
 * -----------------
 * Client component rendering the administrative blog table. It presents the
 * posts inside a Material UI data grid so administrators can quickly scan the
 * published catalog, jump to the public article, open the editor or remove the
 * post altogether. The component handles deletion optimistically while asking
 * Next.js to refresh server data so the grid always reflects the latest
 * database state.
 */

"use client";

import { useCallback, useMemo, useState, useTransition } from "react";
import NextLink from "next/link";
import { Button, Stack } from "@mui/material";
import {
  DataGrid,
  type GridColDef,
  type GridRenderCellParams,
} from "@mui/x-data-grid";
import { useRouter } from "next/navigation";
import { deletePost } from "./actions/delete-post";

/**
 * Intl formatter reused across column definitions so the date rendering stays
 * consistent and avoids recreating the formatter on every cell render.
 */
const dateTimeFormatter = new Intl.DateTimeFormat("en-US", {
  dateStyle: "medium",
  timeStyle: "short",
});

function formatDate(value: unknown) {
  if (!value) {
    return "";
  }
  try {
    return dateTimeFormatter.format(new Date(value as string));
  } catch (error) {
    console.error("Failed to format blog post date", error);
    return String(value);
  }
}

export interface AdminPostRow {
  id: string;
  title: string;
  slug: string;
  createdAt: string;
  updatedAt: string;
}

export function PostsClient({ posts }: { posts: AdminPostRow[] }) {
  const router = useRouter();
  const [pendingSlug, setPendingSlug] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  const handleDelete = useCallback(
    (slug: string) => {
      if (!slug) {
        return;
      }
      setPendingSlug(slug);
      startTransition(async () => {
        try {
          await deletePost(slug);
          router.refresh();
        } catch (error) {
          console.error("Failed to delete blog post", error);
        } finally {
          setPendingSlug(null);
        }
      });
    },
    [router],
  );

  const columns = useMemo<Array<GridColDef<AdminPostRow>>>(
    () => [
      {
        field: "title",
        headerName: "Title",
        flex: 1,
        minWidth: 220,
      },
      {
        field: "slug",
        headerName: "Slug",
        flex: 1,
        minWidth: 200,
      },
      {
        field: "createdAt",
        headerName: "Published",
        flex: 1,
        minWidth: 200,
        valueFormatter: ({ value }) => formatDate(value),
      },
      {
        field: "updatedAt",
        headerName: "Last Updated",
        flex: 1,
        minWidth: 200,
        valueFormatter: ({ value }) => formatDate(value),
      },
      {
        field: "actions",
        headerName: "Actions",
        sortable: false,
        filterable: false,
        minWidth: 280,
        align: "right",
        headerAlign: "right",
        renderCell: (params: GridRenderCellParams<AdminPostRow>) => (
          <Stack
            direction="row"
            spacing={1}
            justifyContent="flex-end"
            sx={{ width: "100%" }}
          >
            <Button
              component={NextLink}
              href={`/blog/${params.row.slug}`}
              size="small"
              target="_blank"
              rel="noopener"
            >
              View
            </Button>
            <Button
              component={NextLink}
              href={`/admin/blog/${params.row.slug}/edit`}
              variant="outlined"
              size="small"
            >
              Edit
            </Button>
            <Button
              variant="outlined"
              color="error"
              size="small"
              onClick={() => handleDelete(params.row.slug)}
              disabled={isPending && pendingSlug === params.row.slug}
            >
              Delete
            </Button>
          </Stack>
        ),
      },
    ],
    [handleDelete, isPending, pendingSlug],
  );

  return (
    <DataGrid
      autoHeight
      disableRowSelectionOnClick
      rows={posts}
      columns={columns}
      initialState={{
        sorting: {
          sortModel: [{ field: "createdAt", sort: "desc" }],
        },
      }}
      sx={{
        backgroundColor: "background.paper",
        borderRadius: 2,
        border: "none",
        boxShadow: 1,
        "& .MuiDataGrid-columnHeaders": {
          backgroundColor: "grey.100",
        },
      }}
    />
  );
}
