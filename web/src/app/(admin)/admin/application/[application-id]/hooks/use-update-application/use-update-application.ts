import { client } from "@/modules/api/client";
import { ProgramApplication } from "@prisma/client";
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
      client.api.v1["program-application"][":id"]["admin"].$put({
        param: {
          id: params.arg.id,
        },
        json: {
          programApplication: params.arg.programApplication,
        },
      });
    },
  );
}
