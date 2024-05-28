"use server";

import { prisma } from "@/modules/prisma/lib/prisma-client/prisma-client";
import { checkAdminPermissions } from "@/modules/roles/lib/check-admin-permissions/check-admin-permissions";

export async function toggleRole(data: { userId: string; roleId: string }) {
  await checkAdminPermissions();

  const { userId, roleId } = data;

  if (!userId || !roleId) {
    throw new Error("Invalid form data");
  }

  const hasRole = await prisma.userRole.findFirst({
    where: {
      userId,
      roleId,
    },
  });

  if (hasRole) {
    await prisma.userRole.delete({
      where: {
        id: hasRole.id,
      },
    });
  } else {
    await prisma.userRole.create({
      data: {
        userId,
        roleId,
      },
    });
  }

  return { success: true };
}
