"use server";

import { prisma } from "@/modules/prisma/lib/prisma-client/prisma-client";
import { checkAdminPermissions } from "@/modules/roles/lib/check-admin-permissions/check-admin-permissions";
import { ProgramRoleName } from "@prisma/client";

export async function assignProgramRole(data: {
  userId: string;
  programId: string;
  role: ProgramRoleName;
}) {
  await checkAdminPermissions();

  const { userId, programId, role } = data;

  const hasRole = await prisma.programRole.findFirst({
    where: { userId, programId },
  });

  if (hasRole) {
    await prisma.programRole.update({
      where: { id: hasRole.id },
      data: { name: role },
    });
  } else {
    await prisma.programRole.create({
      data: { userId, programId, name: role },
    });
  }
}

export async function deleteProgramRole(id: string) {
  await checkAdminPermissions();

  await prisma.programRole.delete({
    where: { id },
  });
}
