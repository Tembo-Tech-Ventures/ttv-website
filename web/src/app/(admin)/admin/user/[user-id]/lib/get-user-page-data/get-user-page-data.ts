import { prisma } from "@/modules/prisma/lib/prisma-client/prisma-client";

export async function getUserPageData(id: string) {
  const user = await prisma.user.findUnique({
    where: {
      id,
    },
    include: {
      sessions: true,
      programApplications: {
        include: {
          program: {
            include: {
              curriculum: {},
            },
          },
        },
      },
      userRoles: {
        include: {
          role: {},
        },
      },
    },
  });
  const roles = await prisma.role.findMany();
  return { user, roles };
}

export type UserPageData = Awaited<ReturnType<typeof getUserPageData>>;
