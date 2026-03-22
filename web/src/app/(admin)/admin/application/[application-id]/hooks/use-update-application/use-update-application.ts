import { adminUpdateProgramApplication } from "@/app/actions/program-application";
import type { ProgramApplication } from "@/generated/prisma/browser";
import useSWRMutation from "swr/mutation";

export function useUpdateApplication() {
  return useSWRMutation(
    "updateStatus",
    async (
      x,
      params: {
        arg: {
          id: string;
          programApplication: Partial<ProgramApplication>;
        };
      },
    ) => {
      await adminUpdateProgramApplication(
        params.arg.id,
        params.arg.programApplication,
      );
    },
  );
}
