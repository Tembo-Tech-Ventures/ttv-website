import { Stack, Typography } from "@mui/material";
import { getProgramPageData } from "../../lib/get-program-page-data/get-program-page-data";
import { AssignProgramRoles } from "./components/assign-program-role/assign-program-role";
import { AssignedProgramRoles } from "./components/assigned-program-roles/assigned-program-roles";

interface ProgramRolesProps {
  programId: string;
}

export async function ProgramRoles({ programId }: ProgramRolesProps) {
  const { program, usersToAssign } = await getProgramPageData(programId);
  const programRoles = program?.programRoles || [];

  return (
    <Stack spacing={2}>
      <Typography variant="h5" color="white">
        Program Roles
      </Typography>
      <Stack spacing={2} py={2}>
        <AssignedProgramRoles programRoles={programRoles} />
      </Stack>
      <AssignProgramRoles usersToAssign={usersToAssign} programId={programId} />
    </Stack>
  );
}
