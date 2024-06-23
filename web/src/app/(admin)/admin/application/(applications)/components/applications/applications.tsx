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
          width: 80,
          renderCell: (params) => (
            <Link href={`/admin/application/${params.row.id}`}>Open</Link>
          ),
        },
        // fields
        { field: "id", headerName: "ID", width: 80 },
        { field: "createdAt", headerName: "Created At", width: 150 },
        { field: "status", headerName: "Status", width: 120 },
        { field: "userEmail", headerName: "Email", width: 250 },
        { field: "programName", headerName: "Program", width: 150 },
        { field: "partnerName", headerName: "Partner", width: 150 },
        { field: "curriculumName", headerName: "Curriculum", width: 80 },
      ]}
      rows={applications.map((app) => ({
        ...app,
        userEmail: app.user.email,
        programName: app?.program?.name,
        curriculumName: app?.program?.curriculum?.title,
        partnerName: app?.partner?.name,
        createdAt: new Date(app.createdAt).toISOString(),
      }))}
    ></DataGrid>
  );
}
