"use server";

/**
 * **Program Role Actions**
 *
 * These helpers assign or remove user roles for a given program. Before server
 * actions, this logic lived behind Hono REST endpoints. Calling these functions
 * directly keeps the data mutations close to the components that trigger them
 * and drastically reduces boilerplate.
 *
 * Both actions require the caller to have admin permissions as enforced by the
 * `checkAdminPermissions` helper.
 */

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

  const existing = await prisma.programRole.findFirst({
    where: { userId, programId },
  });

  if (existing) {
    await prisma.programRole.update({
      where: { id: existing.id },
      data: { name: role },
    });
  } else {
    await prisma.programRole.create({
      data: { userId, programId, name: role },
    });
  }

  return { success: true } as const;
}

export async function deleteProgramRole(id: string) {
  await checkAdminPermissions();

  await prisma.programRole.delete({ where: { id } });

  return { success: true } as const;
}
