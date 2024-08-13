"use client";

import { IconButton, Stack, Typography } from "@mui/material";
import { Delete } from "@mui/icons-material";
import useSWRMutation from "swr/mutation";
import { client } from "@/modules/api/client";
import { getProgramPageData } from "../../../../lib/get-program-page-data/get-program-page-data";
import { useRouter } from "next/navigation";

interface AssignedProgramRolesProps {
  programRoles: NonNullable<
    Awaited<ReturnType<typeof getProgramPageData>>["program"]
  >["programRoles"];
}

export function AssignedProgramRoles({
  programRoles,
}: AssignedProgramRolesProps) {
  const router = useRouter();

  const { trigger } = useSWRMutation(
    "deleteProgramRole",
    async (x, params: { arg: { programRoleId: string } }) => {
      await client.api.v1["program-role"][":id"].$delete({
        param: {
          id: params.arg.programRoleId,
        },
      });
      router.refresh();
    },
  );

  return (
    <>
      {programRoles.map((programRole) => (
        <Stack
          direction="row"
          key={programRole.id}
          spacing={1}
          alignItems="center"
        >
          <Typography key={programRole.id} color="white">
            {programRole.user.email} - {programRole.name}
          </Typography>
          <IconButton
            color="error"
            onClick={() =>
              trigger({
                programRoleId: programRole.id,
              })
            }
          >
            <Delete />
          </IconButton>
        </Stack>
      ))}
    </>
  );
}
