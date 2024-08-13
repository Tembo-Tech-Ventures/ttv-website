"use client";

import { FormLabel, MenuItem, Select } from "@mui/material";
import { useParams, useRouter } from "next/navigation";
import { useUpdateApplication } from "../../hooks/use-update-application/use-update-application";

interface ProgramProps {
  value?: string;
  options: {
    label: string;
    value: string;
  }[];
}

export function Program({ value, options }: ProgramProps) {
  const router = useRouter();
  const params = useParams();
  const applicationId = params["application-id"];
  const { trigger } = useUpdateApplication();

  return (
    <FormLabel>
      <Select
        value={value || ""}
        name="status"
        id="status"
        onChange={async (e) => {
          await trigger({
            id: applicationId as string,
            programApplication: { programId: e.target.value as string },
          });
          router.refresh();
        }}
      >
        <MenuItem value="">Status</MenuItem>
        {options?.map((option) => (
          <MenuItem key={option.value} value={option.value}>
            {option.label}
          </MenuItem>
        ))}
      </Select>
    </FormLabel>
  );
}
