import { prisma } from "@/modules/prisma/lib/prisma-client/prisma-client";

export async function getUsers() {
  return await prisma.user.findMany({
    include: {
      userRoles: {
        include: {
          role: {},
        },
      },
      programApplications: {
        include: {
          partner: {},
          program: {
            include: {
              curriculum: {},
            },
          },
        },
      },
    },
  });
}
