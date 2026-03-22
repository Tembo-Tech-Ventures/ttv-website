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
import { customColors, getShadow } from "@/modules/mui/theme/constants";

/**
 * Precomputed style helpers keep the gradient-heavy aesthetic consistent while
 * satisfying Prettier's preferred line lengths.
 */
const GRID_BACKGROUND_GRADIENT =
  "linear-gradient(180deg, rgba(255,255,255,0.97), rgba(255,255,255,0.9))";
const GRID_HEADER_GRADIENT = `linear-gradient(135deg, ${customColors.dark.main}, ${customColors.lessDark.main})`;
const GRID_STRIPED_ROW_COLOR = "rgba(44,105,100,0.05)";
const GRID_PAGINATION_SELECTOR =
  "& .MuiTablePagination-root, & .MuiTablePagination-selectLabel, & .MuiTablePagination-displayedRows";

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
        valueFormatter: (value: unknown) => formatDate(value),
      },
      {
        field: "updatedAt",
        headerName: "Last Updated",
        flex: 1,
        minWidth: 200,
        valueFormatter: (value: unknown) => formatDate(value),
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
              sx={{
                fontWeight: 600,
                color: customColors.dark.main,
                backgroundColor: "rgba(255,255,255,0.8)",
                border: "1px solid rgba(1,61,57,0.2)",
                "&:hover": {
                  backgroundColor: "rgba(255,255,255,1)",
                },
              }}
            >
              View
            </Button>
            <Button
              component={NextLink}
              href={`/admin/blog/${params.row.slug}/edit`}
              variant="contained"
              size="small"
              sx={{
                fontWeight: 600,
                backgroundColor: customColors.lessDark.main,
                color: "common.white",
                "&:hover": {
                  backgroundColor: customColors.dark.main,
                },
              }}
            >
              Edit
            </Button>
            <Button
              variant="contained"
              color="error"
              size="small"
              onClick={() => handleDelete(params.row.slug)}
              disabled={isPending && pendingSlug === params.row.slug}
              sx={{ fontWeight: 600 }}
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
        backgroundImage: GRID_BACKGROUND_GRADIENT,
        borderRadius: 4,
        border: "1px solid rgba(255,255,255,0.2)",
        boxShadow: getShadow("md"),
        overflow: "hidden",
        "& .MuiDataGrid-columnHeaders": {
          backgroundImage: GRID_HEADER_GRADIENT,
          color: "common.white",
          borderBottom: "1px solid rgba(255,255,255,0.2)",
        },
        "& .MuiDataGrid-columnHeader, & .MuiDataGrid-cell": {
          borderColor: "rgba(1,61,57,0.08)",
        },
        "& .MuiDataGrid-row:nth-of-type(odd)": {
          backgroundColor: GRID_STRIPED_ROW_COLOR,
        },
        "& .MuiDataGrid-footerContainer": {
          backgroundColor: "rgba(255,255,255,0.85)",
          borderTop: "1px solid rgba(1,61,57,0.12)",
        },
        [GRID_PAGINATION_SELECTOR]: {
          color: "text.primary",
        },
      }}
    />
  );
}
