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
import { assignProgramRole } from "./actions/assign-program-role";
import { useRouter } from "next/navigation";

interface AssignProgramRolesProps {
  usersToAssign: { id: string; email: string }[];
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

  return (
    <form
      onSubmit={async (e) => {
        e.preventDefault();
        assignProgramRole(form.userId, programId, form.role);
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
        <Button type="submit" variant="contained">
          Submit
        </Button>
      </Stack>
    </form>
  );
}
