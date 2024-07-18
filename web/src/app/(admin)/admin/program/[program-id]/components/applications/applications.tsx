"use client";

import { DataGrid } from "@mui/x-data-grid";
import { getProgramPageData } from "../../lib/get-user-page-data/get-user-page-data";
import { Link } from "@/components/link/link";

interface ApplicationsProps {
  userPageData: Awaited<ReturnType<typeof getProgramPageData>>;
}

export function Applications({ userPageData }: ApplicationsProps) {
  const { user } = userPageData;
  const { programApplications } = user || {};
  return (
    <DataGrid
      columns={[
        {
          field: "open",
          headerName: "Open",
          width: 90,
          renderCell: (params) => (
            <Link href={`/admin/application/${params.row.id}`}>Open</Link>
          ),
        },
        { field: "id", headerName: "ID", width: 90 },
        { field: "status", headerName: "Status", width: 150 },
        { field: "program", headerName: "Program", width: 150 },
        { field: "curriculum", headerName: "Curriculum", width: 150 },
      ]}
      rows={programApplications?.map((application) => ({
        ...application,
        program: application?.program?.name,
        curriculum: application?.program?.curriculum?.title,
      }))}
    ></DataGrid>
  );
}
