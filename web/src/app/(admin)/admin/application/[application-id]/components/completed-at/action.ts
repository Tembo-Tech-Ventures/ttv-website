"use server";

import { prisma } from "@/modules/prisma/lib/prisma-client/prisma-client";
import { checkAdminPermissions } from "@/modules/roles/lib/check-admin-permissions/check-admin-permissions";

export async function updateCompletedAt(formData: FormData) {
  checkAdminPermissions();
  const applicationId = formData.get("applicationId") as string;
  const completedAt = formData.get("completedAt") as string | null;
  if (!applicationId) {
    throw new Error("Invalid form data");
  }
  await prisma.programApplication.update({
    where: {
      id: applicationId,
    },
    data: { completedAt },
  });
}
