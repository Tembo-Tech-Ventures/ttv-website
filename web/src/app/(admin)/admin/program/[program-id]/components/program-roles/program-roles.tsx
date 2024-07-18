import { Stack, Typography } from "@mui/material";
import { getProgramPageData } from "../../lib/get-program-page-data/get-program-page-data";
import { AssignProgramRoles } from "./components/assign-program-role/assign-program-role";

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
      <Stack spacing={1}>
        {programRoles.map((programRole) => (
          <Typography key={programRole.id} color="white">
            {programRole.user.email} - {programRole.name}
          </Typography>
        ))}
      </Stack>
      <AssignProgramRoles usersToAssign={usersToAssign} programId={programId} />
    </Stack>
  );
}
