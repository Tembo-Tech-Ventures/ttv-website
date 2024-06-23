"use client";

import { Box, FormLabel, MenuItem, Select } from "@mui/material";
import { useParams, useRouter } from "next/navigation";
import { updateCompletedAt } from "./action";
import { DatePicker } from "@mui/x-date-pickers";
import dayjs from "dayjs";

interface ProgramProps {
  value?: string;
}

export function CompletedAt({ value }: ProgramProps) {
  const router = useRouter();
  const params = useParams();
  const applicationId = params["application-id"];

  return (
    <Box>
      <DatePicker
        label="Completed At"
        onChange={async (d) => {
          const formData = new FormData();
          d?.isValid() && formData.set("completedAt", d.toISOString());
          formData.set("applicationId", applicationId as string);
          await updateCompletedAt(formData);
          router.refresh();
        }}
        value={value ? dayjs(value) : null}
      />
    </Box>
  );
}
