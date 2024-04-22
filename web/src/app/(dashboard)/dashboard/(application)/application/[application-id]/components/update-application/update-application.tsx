"use client";

import { Button, Stack } from "@mui/material";
import { ProgramApplication } from "@prisma/client";
import { useAtom } from "jotai";
import { useRouter } from "next/navigation";
import { useCallback } from "react";
import { applicationValuesAtom } from "../../../../atoms/application.atom";
import { ApplicationForm } from "../../../../components/application-form/application-form";
import useSWRMutation from "swr/mutation";

export function UpdateApplication({
  application,
}: {
  application: ProgramApplication;
}) {
  const router = useRouter();
  const [submission] = useAtom(applicationValuesAtom);

  const submit = useCallback(
    async (
      [url, method]: [string, string],
      { arg }: { arg: typeof submission },
    ) => {
      const response = fetch(url, {
        method,
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          version: (application.application as any).version,
          submission: arg,
        }),
      });
      return (await response).json();
    },
    [application.application],
  );

  const { trigger, isMutating } = useSWRMutation(
    [`/api/application/${application.id}`, "PUT"],
    submit,
  );

  return (
    <Stack
      sx={{
        maxWidth: (theme) => theme.breakpoints.values.md,
      }}
      spacing={2}
      pt={2}
    >
      <ApplicationForm existing={application} />
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
          {isMutating ? "Updating..." : "Update"}
        </Button>
      </div>
    </Stack>
  );
}
