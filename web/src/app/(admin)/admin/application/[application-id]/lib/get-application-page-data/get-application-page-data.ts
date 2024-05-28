import { prisma } from "@/modules/prisma/lib/prisma-client/prisma-client";

export async function getApplicationPageData(id: string) {
  const application = await prisma.programApplication.findUnique({
    where: {
      id,
    },
    include: {
      program: true,
      user: true,
    },
  });
  const partners = await prisma.programPartner.findMany();
  const programs = await prisma.program.findMany();
  return { application, partners, programs };
}
