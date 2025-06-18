"use server";

/**
 * Server actions to manage Program Roles.
 *
 * These actions replace REST API endpoints formerly implemented using Hono.
 * They are invoked directly from client components using the Next.js Server
 * Actions mechanism. Each function performs a single database operation and
 * throws errors that can be handled by the caller.
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
