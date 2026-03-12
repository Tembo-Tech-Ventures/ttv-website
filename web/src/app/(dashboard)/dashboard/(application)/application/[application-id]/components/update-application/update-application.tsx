"use client";

import { updateProgramApplication } from "@/app/actions/program-application";
import { Button, Stack } from "@mui/material";
import { ProgramApplication, ProgramPartner, User } from "@prisma/client";
import { useAtom } from "jotai";
import { useRouter } from "next/navigation";
import { useCallback } from "react";
import useSWRMutation from "swr/mutation";
import {
  applicationSchemaVersion,
  applicationValuesAtom,
} from "../../../../atoms/application.atom";
import { ApplicationForm } from "../../../../components/application-form/application-form";

export function UpdateApplication({
  application,
  partners,
  user,
}: {
  application: ProgramApplication;
  partners: ProgramPartner[];
  user: User;
}) {
  const router = useRouter();
  const [submission] = useAtom(applicationValuesAtom);

  const submit = useCallback(
    async (method: string, { arg }: { arg: typeof submission }) => {
      return await updateProgramApplication(application.id, {
        version: applicationSchemaVersion,
        submission: arg,
        partnerId:
          (arg.find((item) => item.name === "partnerId")?.value as string) ||
          "",
        name: (arg.find((item) => item.name === "name")?.value as string) || "",
      });
    },
    [application.id],
  );

  const { trigger, isMutating } = useSWRMutation(
    "updateProgramApplication",
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
      <ApplicationForm existing={application} partners={partners} user={user} />
      <div>
        <Button
          variant="contained"
          size="large"
          onClick={async () => {
            const application = await trigger(submission);
            if (application && "id" in application) {
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
