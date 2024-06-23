"use client";

import { FormLabel, MenuItem, Select } from "@mui/material";
import { useParams, useRouter } from "next/navigation";
import { updateStatus } from "./action";

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

  return (
    <FormLabel>
      <Select
        value={value || ""}
        name="status"
        id="status"
        onChange={async (e) => {
          const formData = new FormData();
          formData.set("programId", e.target.value as string);
          formData.set("applicationId", applicationId as string);
          await updateStatus(formData);
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
