"use server";

import { prisma } from "@/modules/prisma/lib/prisma-client/prisma-client";
import { ProgramRoleName } from "@prisma/client";

export async function assignProgramRole(
  userId: string,
  programId: string,
  role: ProgramRoleName,
) {
  if (!userId || !programId || !role) {
    throw new Error("Invalid form data");
  }

  const hasRole = await prisma.programRole.findFirst({
    where: {
      userId,
      programId,
    },
  });

  if (hasRole) {
    await prisma.programRole.update({
      where: {
        id: hasRole.id,
      },
      data: {
        name: role,
      },
    });
  } else {
    await prisma.programRole.create({
      data: {
        userId,
        programId,
        name: role,
      },
    });
  }

  return { success: true };
}
