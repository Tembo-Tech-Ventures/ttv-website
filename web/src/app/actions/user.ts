"use server";

import { getServerSession } from "@/modules/auth/lib/get-server-session/get-server-session";
import { prisma } from "@/modules/prisma/lib/prisma-client/prisma-client";
import { checkAdminPermissions } from "@/modules/roles/lib/check-admin-permissions/check-admin-permissions";
import { revalidatePath } from "next/cache";

export async function updateUserProfile(data: {
  name?: string | null;
  image?: string | null;
}) {
  const userId = (await getServerSession())?.user?.id;
  if (!userId) throw new Error("Unauthorized");

  const user = await prisma.user.update({
    where: { id: userId },
    data,
  });

  revalidatePath("/dashboard/profile");
  return user;
}

export async function adminUpdateUser(id: string, name: string | null) {
  await checkAdminPermissions();

  const user = await prisma.user.update({
    where: { id },
    data: { name },
  });

  return user;
}
