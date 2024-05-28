"use client";

import { Link } from "@/components/link/link";
import { DataGrid } from "@mui/x-data-grid";
import { getUsers } from "../../lib/get-users/get-users";

interface UsersProps {
  users: Awaited<ReturnType<typeof getUsers>>;
}

export default function Users({ users }: UsersProps) {
  return (
    <DataGrid
      columns={[
        // button to open
        {
          field: "open",
          headerName: "",
          width: 80,
          renderCell: (params) => (
            <Link href={`/admin/user/${params.row.id}`}>Open</Link>
          ),
        },
        // fields
        { field: "id", headerName: "ID", width: 90 },
        { field: "email", headerName: "Email", width: 200 },
        { field: "name", headerName: "Name", width: 150 },
        { field: "roles", headerName: "Roles", width: 200 },
        { field: "applications", headerName: "Applications", width: 150 },
      ]}
      rows={users.map((user) => ({
        ...user,
        roles: user.userRoles.map((role) => role.role?.name).join(", "),
        applications: user.programApplications?.length || 0,
      }))}
    ></DataGrid>
  );
}
