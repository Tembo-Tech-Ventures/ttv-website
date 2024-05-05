"use client";

import { Button, Stack, Typography } from "@mui/material";
import { useAtom } from "jotai";
import { useRouter } from "next/navigation";
import { useCallback } from "react";
import useSWR from "swr/mutation";
import {
  applicationSchemaVersion,
  applicationValuesAtom,
} from "../../../atoms/application.atom";
import { ApplicationForm } from "../../../components/application-form/application-form";
import { client } from "@/modules/api/client";
import { ProgramPartner } from "@prisma/client";

interface ApplyProps {
  partners: ProgramPartner[];
}

export default function Apply({ partners }: ApplyProps) {
  const router = useRouter();
  const [submission] = useAtom(applicationValuesAtom);

  const submit = useCallback(
    async (
      [url, method]: [string, string],
      { arg }: { arg: typeof submission },
    ) => {
      const response = await client.api.v1["program-application"].$post({
        json: {
          version: applicationSchemaVersion,
          submission: arg,
          partnerId:
            (arg.find((item) => item.name === "partnerId")?.value as string) ||
            "",
        },
      });
      return await response.json();
    },
    [],
  );

  const { trigger, isMutating } = useSWR(["/api/application", "POST"], submit);

  return (
    <Stack
      sx={{
        maxWidth: (theme) => theme.breakpoints.values.md,
      }}
      spacing={2}
    >
      <Typography variant="h4" color="white">
        Apply
      </Typography>
      <ApplicationForm partners={partners} />
      <div>
        <Button
          variant="contained"
          size="large"
          onClick={async () => {
            const application = await trigger(submission);
            if (application?.id) {
              router.refresh();
            }
          }}
          disabled={isMutating}
        >
          {isMutating ? "Submitting..." : "Submit"}
        </Button>
      </div>
    </Stack>
  );
}
