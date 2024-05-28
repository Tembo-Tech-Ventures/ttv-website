import { checkAdminPermissions } from "@/modules/roles/lib/check-admin-permissions/check-admin-permissions";
import { Stack, Typography } from "@mui/material";
import Applications from "./components/applications/applications";
import { getApplications } from "./lib/get-applications/get-applications";

export default async function ApplicationsPage() {
  await checkAdminPermissions();
  const applications = await getApplications();
  return (
    <Stack spacing={2}>
      <Typography variant="h4" color="white">
        Applications
      </Typography>
      <Applications applications={applications} />
    </Stack>
  );
}
