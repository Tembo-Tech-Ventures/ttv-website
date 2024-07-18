import { prisma } from "@/modules/prisma/lib/prisma-client/prisma-client";

export async function getProgramPageData(id: string) {
  const program = await prisma.program.findUnique({
    where: {
      id,
    },
    include: {
      curriculum: true,
      programRoles: {
        include: {
          user: true,
        },
      },
    },
  });

  const usersToAssign = await prisma.user.findMany({
    select: {
      id: true,
      email: true,
    },
  });
  return { program, usersToAssign };
}
