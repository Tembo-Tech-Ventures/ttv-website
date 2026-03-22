import { checkAdminPermissions } from "@/modules/roles/lib/check-admin-permissions/check-admin-permissions";
import { Box, Container, Divider, Stack, Typography } from "@mui/material";
import { getUserPageData } from "./lib/get-user-page-data/get-user-page-data";
import { Applications } from "./components/applications/applications";
import { Roles } from "./components/roles/roles";
import { Name } from "./components/name/name";

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
  params: Promise<{ "user-id": string }>;
}) {
  await checkAdminPermissions();
  const { "user-id": applicationId } = await params;
  const userPageData = await getUserPageData(applicationId);
  const user = userPageData?.user;
  return (
    <Container>
      <Stack spacing={2}>
        <Name userPageData={userPageData} />
        <Typography variant="h4" color="white">
          <Typography variant="body1">{user?.email || "No email"}</Typography>
        </Typography>
        <Divider />
        <Typography>
          <b>Roles: </b>
        </Typography>
        <Roles userPageData={userPageData} />
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
