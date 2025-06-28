import { checkAdminPermissions } from "@/modules/roles/lib/check-admin-permissions/check-admin-permissions";
import { Container, Stack, Typography } from "@mui/material";
import { getProgramPageData } from "./lib/get-program-page-data/get-program-page-data";
import { format } from "date-fns";
import { ProgramRoles } from "./components/program-roles/program-roles";

interface PageProps<P extends Record<string, string>> {
  params: P;
}

type Application = {
  version: string;
  submission: {
    name: string;
    type: string;
    label: string;
    value: string;
  }[];
};

export default async function ProgramPage({
  params,
}: PageProps<{ "program-id": string }>) {
  await checkAdminPermissions();
  const programId = params["program-id"];
  const programPageData = await getProgramPageData(programId);
  const { program } = programPageData;
  return (
    <Container>
      <Stack spacing={2}>
        <Typography variant="h4" color="white">
          {program?.curriculum.title} -{" "}
          {format(new Date(program?.startDate || new Date()), "MMM yyyy")}
        </Typography>
        <ProgramRoles programId={programId} />
      </Stack>
    </Container>
  );
}
