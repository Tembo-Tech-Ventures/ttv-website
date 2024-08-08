"use client";

import { prisma } from "@/modules/prisma/lib/prisma-client/prisma-client";
import {
  Autocomplete,
  Button,
  FormControl,
  InputLabel,
  MenuItem,
  Select,
  Stack,
  TextField,
  Typography,
} from "@mui/material";
import { ProgramRoleName } from "@prisma/client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { getProgramPageData } from "../../../../lib/get-program-page-data/get-program-page-data";
import useSWRMutation from "swr/mutation";
import { client } from "@/modules/api/client";

interface AssignProgramRolesProps {
  usersToAssign: Awaited<
    ReturnType<typeof getProgramPageData>
  >["usersToAssign"];
  programId: string;
}

export function AssignProgramRoles({
  usersToAssign,
  programId,
}: AssignProgramRolesProps) {
  const router = useRouter();
  const [form, setForm] = useState<{
    userId: string;
    role: ProgramRoleName;
  }>({
    userId: "",
    role: ProgramRoleName.INSTRUCTOR,
  });

  const { trigger, isMutating } = useSWRMutation(
    "assignProgramRole",
    async (
      x,
      params: {
        arg: {
          userId: string;
          programId: string;
          role: ProgramRoleName;
        };
      }
    ) => {
      await client.api.v1["program-role"].$post({
        json: params.arg,
      });
      router.refresh();
    }
  );

  return (
    <form
      onSubmit={async (e) => {
        e.preventDefault();
        trigger({ programId, ...form });
        router.refresh();
      }}
    >
      <Stack direction="row" spacing={1}>
        <Autocomplete
          disablePortal
          options={usersToAssign.map((user) => ({
            label: user.email,
            value: user.id,
          }))}
          sx={{ width: 300 }}
          renderInput={(params) => <TextField {...params} label="User" />}
          onChange={(event, value) =>
            setForm({ ...form, userId: value?.value ?? "" })
          }
          isOptionEqualToValue={(option, value) => option.value === form.userId}
        />
        <FormControl>
          <InputLabel>Role</InputLabel>
          <Select
            value={form.role}
            label="Role"
            onChange={(event) =>
              setForm({ ...form, role: event.target.value as ProgramRoleName })
            }
          >
            <MenuItem value={ProgramRoleName.INSTRUCTOR}>Instructor</MenuItem>
            <MenuItem value={ProgramRoleName.TA}>TA</MenuItem>
          </Select>
        </FormControl>
        <Button type="submit" variant="contained" disabled={isMutating}>
          {isMutating ? "Assigning..." : "Assign"}
        </Button>
      </Stack>
    </form>
  );
}
