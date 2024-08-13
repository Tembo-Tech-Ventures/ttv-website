import { checkAdminPermissions } from "@/modules/roles/lib/check-admin-permissions/check-admin-permissions";
import { Stack, Typography } from "@mui/material";
import Programs from "./components/programs/programs";
import { getPrograms } from "./lib/get-programs/get-programs";

export default async function UsersPage() {
  await checkAdminPermissions();
  const programs = await getPrograms();
  return (
    <Stack spacing={2}>
      <Typography variant="h4" color="white">
        Programs
      </Typography>
      <Programs programs={programs} />
    </Stack>
  );
}
