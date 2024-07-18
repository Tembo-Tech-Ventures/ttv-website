import { prisma } from "@/modules/prisma/lib/prisma-client/prisma-client";

export async function getProgramPageData(id: string) {
  const user = await prisma.program.findUnique({
    where: {
      id,
    },
    include: {
      curriculum: true,
      programRoles: {
        include: {
          role: true,
          user: true,
        },
      },
    },
  });
  return { program };
}
