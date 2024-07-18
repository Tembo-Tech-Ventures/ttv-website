import { checkAdminPermissions } from "@/modules/roles/lib/check-admin-permissions/check-admin-permissions";
import { Box, Container, Divider, Stack, Typography } from "@mui/material";
import { getProgramPageData } from "./lib/get-user-page-data/get-user-page-data";
import { Applications } from "./components/applications/applications";
import { Roles } from "./components/roles/roles";

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
  params: { "program-id": string };
}) {
  await checkAdminPermissions();
  const programId = params["program-id"];
  const programPageData = await getProgramPageData(programId);
  const { program } = programPageData;
  return (
    <Container>
      <Stack spacing={2}>
        <Typography variant="h4" color="white">
          <Typography variant="body1">{program?.curriculum.title}</Typography>
        </Typography>
      </Stack>
    </Container>
  );
}
