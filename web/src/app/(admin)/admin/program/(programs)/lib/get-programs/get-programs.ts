import { prisma } from "@/modules/prisma/lib/prisma-client/prisma-client";

export async function getPrograms() {
  return await prisma.program.findMany({
    include: {
      programApplications: {},
      programRoles: {},
      curriculum: {},
    },
  });
}
