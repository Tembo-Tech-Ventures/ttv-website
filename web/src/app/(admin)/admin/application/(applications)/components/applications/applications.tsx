"use client";

import { DataGrid } from "@mui/x-data-grid";
import { ProgramApplication } from "@prisma/client";
import { getApplications } from "../../lib/get-applications/get-applications";
import { Link } from "@/components/link/link";

interface ApplicationsProps {
  applications: Awaited<ReturnType<typeof getApplications>>;
}

export default function Applications({ applications }: ApplicationsProps) {
  return (
    <DataGrid
      columns={[
        // button to open
        {
          field: "open",
          headerName: "Open",
          width: 150,
          renderCell: (params) => (
            <Link href={`/admin/application/${params.row.id}`}>Open</Link>
          ),
        },
        // fields
        { field: "id", headerName: "ID", width: 90 },
        { field: "status", headerName: "Status", width: 150 },
        { field: "userEmail", headerName: "Email", width: 200 },
        { field: "programName", headerName: "Program", width: 200 },
        { field: "curriculumName", headerName: "Curriculum", width: 200 },
      ]}
      rows={applications.map((app) => ({
        ...app,
        userEmail: app.user.email,
        programName: app?.program?.name,
        curriculumName: app?.program?.curriculum?.title,
      }))}
    ></DataGrid>
  );
}
