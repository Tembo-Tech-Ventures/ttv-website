"use client";

import { Button, CircularProgress, Stack } from "@mui/material";
import { useRouter } from "next/navigation";
import { PiCheckCircleDuotone, PiXCircleDuotone } from "react-icons/pi";
import { getProgramPageData } from "../../lib/get-user-page-data/get-user-page-data";
import { toggleRole } from "./actions/toggle-role";
import useSWRMutation from "swr/mutation";

interface ApplicationsProps {
  userPageData: Awaited<ReturnType<typeof getProgramPageData>>;
}

export function Roles({ userPageData }: ApplicationsProps) {
  const { user, roles } = userPageData;
  const userRoles = user?.userRoles;
  const router = useRouter();

  const { trigger, isMutating } = useSWRMutation(
    "toggleRole",
    async (x, params: { arg: { userId: string; roleId: string } }) => {
      await toggleRole(params.arg);
      router.refresh();
    },
  );

  if (!user || !roles) return null;

  return (
    <Stack direction="row" spacing={2}>
      {isMutating && <CircularProgress />}
      {roles.map((role) => {
        const hasRole = userRoles?.some(
          (userRole) => userRole.roleId === role.id,
        );
        return (
          <Button
            key={role.id}
            variant={hasRole ? "contained" : "outlined"}
            color="primary"
            onClick={() => trigger({ userId: user.id, roleId: role.id })}
          >
            {hasRole ? <PiCheckCircleDuotone /> : <PiXCircleDuotone />}
            {role.name}
          </Button>
        );
      })}
    </Stack>
  );
}
