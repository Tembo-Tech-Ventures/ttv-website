"use client";

import { FormLabel, MenuItem, Select } from "@mui/material";
import { ApplicationStatus } from "@/generated/prisma/browser";
import { useParams, useRouter } from "next/navigation";
import { useUpdateApplication } from "../../hooks/use-update-application/use-update-application";

interface StatusProps {
  value?: string;
}

export function Status({ value }: StatusProps) {
  const options = Object.values(ApplicationStatus);
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
            programApplication: { status: e.target.value as ApplicationStatus },
          });
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
