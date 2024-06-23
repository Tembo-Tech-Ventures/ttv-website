import { prisma } from "@/modules/prisma/lib/prisma-client/prisma-client";

export async function getApplications() {
  return await prisma.programApplication.findMany({
    include: {
      program: {
        include: {
          curriculum: true,
        },
      },
      partner: true,
      user: true,
    },
  });
}
