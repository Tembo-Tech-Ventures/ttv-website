"use server";

/**
 * **User Profile Actions**
 *
 * Provides simple helpers for updating the currently authenticated user's
 * profile as well as a restricted admin endpoint for updating arbitrary users.
 * Components mutate user data by invoking these functions with `use server`.
 */

import { getServerSession } from "@/modules/auth/lib/get-server-session/get-server-session";
import { prisma } from "@/modules/prisma/lib/prisma-client/prisma-client";
import { checkAdminPermissions } from "@/modules/roles/lib/check-admin-permissions/check-admin-permissions";
import { revalidatePath } from "next/cache";

export async function updateProfile(data: {
  name?: string | null;
  image?: string | null;
}) {
  const session = await getServerSession();
  const userId = session?.user?.id;
  if (!userId) throw new Error("Unauthorized");

  const user = await prisma.user.update({
    where: { id: userId },
    data,
  });

  revalidatePath("/dashboard/profile");

  return user;
}

export async function updateUserAdmin(
  id: string,
  data: { name?: string | null },
) {
  await checkAdminPermissions();

  const user = await prisma.user.update({
    where: { id },
    data,
  });

  return user;
}
