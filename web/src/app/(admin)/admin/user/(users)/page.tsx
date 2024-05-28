import { prisma } from "@/modules/prisma/lib/prisma-client/prisma-client";
import { Stack, Typography } from "@mui/material";
import Users from "./components/users/users";
import { getUsers } from "./lib/get-users/get-users";
import { checkAdminPermissions } from "@/modules/roles/lib/check-admin-permissions/check-admin-permissions";

export default async function UsersPage() {
  await checkAdminPermissions();
  const users = await getUsers();
  return (
    <Stack spacing={2}>
      <Typography variant="h4" color="white">
        Users
      </Typography>
      <Users users={users} />
    </Stack>
  );
}
