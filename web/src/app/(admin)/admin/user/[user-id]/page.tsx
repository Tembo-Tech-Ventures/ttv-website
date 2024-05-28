import { checkAdminPermissions } from "@/modules/roles/lib/check-admin-permissions/check-admin-permissions";
import { Box, Container, Divider, Stack, Typography } from "@mui/material";
import { getUserPageData } from "./lib/get-user-page-data/get-user-page-data";
import { Applications } from "./components/applications/applications";

type Application = {
  version: string;
  submission: {
    name: string;
    type: string;
    label: string;
    value: string;
  }[];
};

export default async function UserPage({
  params,
}: {
  params: { "user-id": string };
}) {
  await checkAdminPermissions();
  const applicationId = params["user-id"];
  const userPageData = await getUserPageData(applicationId);
  const user = userPageData?.user;
  return (
    <Container>
      <Stack spacing={2}>
        <Typography variant="h4" color="white">
          {user?.name || "No name"}
          <br />
          <Typography variant="body1">{user?.email || "No email"}</Typography>
        </Typography>
        <Divider />
        <Typography>
          <b>Roles: </b>
          {user?.userRoles.map((role) => role.role?.name).join(", ") ||
            "No roles"}
        </Typography>
        <Divider />
        <Stack spacing={2}>
          <Typography variant="h5" color="white">
            Applications
          </Typography>
          <Applications userPageData={userPageData} />
        </Stack>
      </Stack>
    </Container>
  );
}
