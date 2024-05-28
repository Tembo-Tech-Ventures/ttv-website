import { getServerSession } from "@/modules/auth/lib/get-server-session/get-server-session";
import { prisma } from "@/modules/prisma/lib/prisma-client/prisma-client";
import { ROLES } from "@/modules/roles/constants";

export async function checkAdminPermissions() {
  const session = await getServerSession();
  if (!session?.user) {
    return false;
  }
  const userId = session.user.id;
  await prisma.userRole.findFirstOrThrow({
    where: {
      userId,
      role: {
        name: ROLES.ADMIN,
      },
    },
  });
  return true;
}
