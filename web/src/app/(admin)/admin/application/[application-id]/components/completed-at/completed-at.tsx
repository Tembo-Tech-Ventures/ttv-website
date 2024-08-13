"use client";

import { Box } from "@mui/material";
import { DatePicker } from "@mui/x-date-pickers";
import dayjs from "dayjs";
import { useParams, useRouter } from "next/navigation";
import { useUpdateApplication } from "../../hooks/use-update-application/use-update-application";

interface ProgramProps {
  value?: string;
}

export function CompletedAt({ value }: ProgramProps) {
  const router = useRouter();
  const params = useParams();
  const applicationId = params["application-id"];
  const { trigger } = useUpdateApplication();

  return (
    <Box>
      <DatePicker
        label="Completed At"
        onChange={async (d) => {
          trigger({
            id: applicationId as string,
            programApplication: {
              completedAt: d?.isValid() ? (d.toISOString() as any) : null,
            },
          });
          router.refresh();
        }}
        value={value ? dayjs(value) : null}
      />
    </Box>
  );
}
