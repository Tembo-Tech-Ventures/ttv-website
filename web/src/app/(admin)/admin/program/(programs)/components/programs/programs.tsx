"use client";

import { Link } from "@/components/link/link";
import { DataGrid } from "@mui/x-data-grid";
import { getPrograms } from "../../lib/get-programs/get-programs";

interface ProgramsProps {
  programs: Awaited<ReturnType<typeof getPrograms>>;
}

export default function Users({ programs }: ProgramsProps) {
  return (
    <DataGrid
      columns={[
        // button to open
        {
          field: "open",
          headerName: "",
          width: 80,
          renderCell: (params) => (
            <Link href={`/admin/program/${params.row.id}`}>Open</Link>
          ),
        },
        // fields
        { field: "id", headerName: "ID", width: 90 },
        { field: "name", headerName: "Name", width: 200 },
        { field: "curriculum", headerName: "Curriculum", width: 200 },
      ]}
      rows={programs.map((program) => ({
        ...program,
        curriculum: program.curriculum.title,
      }))}
    ></DataGrid>
  );
}
