"use server";

import { getServerSession } from "@/modules/auth/lib/get-server-session/get-server-session";
import { prisma } from "@/modules/prisma/lib/prisma-client/prisma-client";
import { checkAdminPermissions } from "@/modules/roles/lib/check-admin-permissions/check-admin-permissions";
import { Prisma } from "@prisma/client";
import { revalidatePath } from "next/cache";

export async function createProgramApplication(data: {
  name: string;
  partnerId: string;
  [key: string]: unknown;
}) {
  const userId = (await getServerSession())?.user?.id;
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
  data: {
    name: string;
    partnerId: string;
    [key: string]: unknown;
  },
) {
  const userId = (await getServerSession())?.user?.id;
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

export async function adminUpdateProgramApplication(
  id: string,
  programApplication: Prisma.ProgramApplicationUncheckedUpdateInput,
) {
  await checkAdminPermissions();

  const application = await prisma.programApplication.update({
    where: { id },
    data: programApplication,
  });

  return application;
}
