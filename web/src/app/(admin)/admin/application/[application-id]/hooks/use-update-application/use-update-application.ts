import { ProgramApplication } from "@prisma/client";
import useSWRMutation from "swr/mutation";
import { updateProgramApplicationAdmin } from "@/actions/programApplication";

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
      await updateProgramApplicationAdmin(
        params.arg.id,
        params.arg.programApplication,
      );
    },
  );
}
