"use client";

import { FormLabel, MenuItem, Select } from "@mui/material";
import { ApplicationStatus } from "@prisma/client";
import { useParams, useRouter } from "next/navigation";
import { updateStatus } from "./action";

interface StatusProps {
  value?: string;
}

export function Status({ value }: StatusProps) {
  const options = Object.values(ApplicationStatus);
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
          formData.set("status", e.target.value as string);
          formData.set("applicationId", applicationId as string);
          await updateStatus(formData);
          router.refresh();
        }}
      >
        <MenuItem value="">Status</MenuItem>
        {options?.map((option) => (
          <MenuItem key={option} value={option}>
            {option}
          </MenuItem>
        ))}
      </Select>
    </FormLabel>
  );
}
