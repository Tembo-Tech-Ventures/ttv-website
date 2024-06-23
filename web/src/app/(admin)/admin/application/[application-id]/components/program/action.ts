"use server";

import { prisma } from "@/modules/prisma/lib/prisma-client/prisma-client";

export async function updateStatus(formData: FormData) {
  const applicationId = formData.get("applicationId") as string;
  const programId = formData.get("programId") as string;
  if (!programId || !applicationId) {
    throw new Error("Invalid form data");
  }
  await prisma.programApplication.update({
    where: {
      id: applicationId,
    },
    data: { programId },
  });
}
