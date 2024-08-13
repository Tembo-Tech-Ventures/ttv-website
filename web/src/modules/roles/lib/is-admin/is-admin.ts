import { getServerSession } from "@/modules/auth/lib/get-server-session/get-server-session";
import { prisma } from "@/modules/prisma/lib/prisma-client/prisma-client";
import { ROLES } from "@/modules/roles/constants";

export async function isAdmin() {
  const session = await getServerSession();
  const userId = session.user.id;
  const found = await prisma.userRole.findFirst({
    where: {
      userId,
      role: {
        name: ROLES.ADMIN,
      },
    },
  });

  return !!found;
}
