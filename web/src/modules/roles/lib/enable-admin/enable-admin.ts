import { getServerSession } from "@/modules/auth/lib/get-server-session/get-server-session";
import { prisma } from "@/modules/prisma/lib/prisma-client/prisma-client";
import { ROLES } from "@/modules/roles/constants";

export async function enableAdmin() {
  const session = await getServerSession();
  if (!session?.user) {
    return false;
  }
  const userId = session.user.id;
  try {
    await prisma.userRole.findFirstOrThrow({
      where: {
        userId,
        role: {
          name: ROLES.ADMIN,
        },
      },
    });
  } catch (e) {
    const role = await prisma.role.findFirstOrThrow({
      where: {
        name: ROLES.ADMIN,
      },
    });
    await prisma.userRole.create({
      data: {
        userId,
        roleId: role.id,
      },
    });
  }
}
