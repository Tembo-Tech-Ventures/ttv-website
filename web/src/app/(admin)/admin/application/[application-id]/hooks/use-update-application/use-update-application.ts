import { adminUpdateProgramApplication } from "@/app/actions/program-application";
import { Prisma } from "@prisma/client";
import useSWRMutation from "swr/mutation";

export function useUpdateApplication() {
  return useSWRMutation(
    "updateStatus",
    async (
      x,
      params: {
        arg: {
          id: string;
          programApplication: Prisma.ProgramApplicationUncheckedUpdateInput;
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
