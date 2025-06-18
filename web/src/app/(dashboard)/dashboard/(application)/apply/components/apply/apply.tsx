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
import { createProgramApplication } from "@/actions/programApplication";
import { ProgramPartner } from "@prisma/client";

interface ApplyProps {
  partners: ProgramPartner[];
}

export default function Apply({ partners }: ApplyProps) {
  const router = useRouter();
  const [submission] = useAtom(applicationValuesAtom);

  const submit = useCallback(
    async (_: string, { arg }: { arg: typeof submission }) => {
      return await createProgramApplication({
        version: applicationSchemaVersion,
        submission: arg,
        partnerId:
          (arg.find((item) => item.name === "partnerId")?.value as string) ||
          "",
        name: (arg.find((item) => item.name === "name")?.value as string) || "",
      });
    },
    [],
  );

  const { trigger, isMutating } = useSWR(`createProgramApplication`, submit);

  return (
    <Stack
      sx={{
        maxWidth: (theme) => theme.breakpoints.values.md,
      }}
      spacing={2}
    >
      <Typography variant="h4" color="white">
        Apply to Tembo Tech Ventures
      </Typography>
      <ApplicationForm partners={partners} />
      <div>
        <Button
          variant="contained"
          size="large"
          onClick={async () => {
            const application = await trigger(submission);
            if ("id" in application) {
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
