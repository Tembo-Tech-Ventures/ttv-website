"use server";

import { prisma } from "@/modules/prisma/lib/prisma-client/prisma-client";
import { ApplicationStatus } from "@prisma/client";

export async function updateStatus(formData: FormData) {
  const status = formData.get("status") as ApplicationStatus | null;
  const applicationId = formData.get("applicationId") as string;
  if (!status || !applicationId) {
    throw new Error("Invalid form data");
  }
  await prisma.programApplication.update({
    where: {
      id: applicationId,
    },
    data: {
      status: status,
    },
  });
}
