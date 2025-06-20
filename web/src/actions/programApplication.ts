"use server";

/**
 * **Program Application Actions**
 *
 * This module contains server actions used to create and update program
 * applications. They were introduced to remove the old `/api/v1` REST routes in
 * favor of direct function calls from React components.
 *
 * Responsibilities are intentionally narrow:
 *  - create and update applications for the currently authenticated user
 *  - expose an admin-only update helper for status changes
 */

import { getServerSession } from "@/modules/auth/lib/get-server-session/get-server-session";
import { prisma } from "@/modules/prisma/lib/prisma-client/prisma-client";
import { checkAdminPermissions } from "@/modules/roles/lib/check-admin-permissions/check-admin-permissions";
import { revalidatePath } from "next/cache";

export async function createProgramApplication(data: {
  name: string;
  partnerId: string;
  [key: string]: unknown;
}) {
  const session = await getServerSession();
  const userId = session?.user?.id;
  if (!userId) throw new Error("Unauthorized");

  await prisma.user.update({
    where: { id: userId },
    data: { name: data.name },
  });

  const application = await prisma.programApplication.create({
    data: {
      userId,
      application: data as any,
      partnerId: data.partnerId,
    },
  });

  revalidatePath("/dashboard/apply");
  return application;
}

export async function updateProgramApplication(
  id: string,
  data: { name: string; partnerId: string; [key: string]: unknown },
) {
  const session = await getServerSession();
  const userId = session?.user?.id;
  if (!userId) throw new Error("Unauthorized");

  await prisma.user.update({
    where: { id: userId },
    data: { name: data.name },
  });

  const application = await prisma.programApplication.update({
    where: { id },
    data: {
      userId,
      application: data as any,
      partnerId: data.partnerId,
    },
  });

  revalidatePath(`/dashboard/apply/${id}`);
  return application;
}

export async function updateProgramApplicationAdmin(
  id: string,
  updates: Record<string, unknown>,
) {
  await checkAdminPermissions();

  const application = await prisma.programApplication.update({
    where: { id },
    data: { ...updates },
  });

  return application;
}
