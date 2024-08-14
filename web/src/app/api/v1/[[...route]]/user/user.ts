import { getServerSession } from "@/modules/auth/lib/get-server-session/get-server-session";
import { prisma } from "@/modules/prisma/lib/prisma-client/prisma-client";
import { checkAdminPermissions } from "@/modules/roles/lib/check-admin-permissions/check-admin-permissions";
import { zValidator } from "@hono/zod-validator";
import { Hono } from "hono";
import { revalidatePath } from "next/cache";
import { z } from "zod";

export const userHandler = new Hono()
  .put(
    "/",
    zValidator(
      "json",
      z.object({
        name: z.string().nullish(),
        image: z.string().nullish(),
      }),
    ),
    async (c) => {
      const body = c.req.valid("json");

      const userId = (await getServerSession())?.user?.id;

      if (!userId) {
        return c.json({ message: "Unauthorized" }, 401);
      }

      const user = await prisma.user.update({
        where: { id: userId },
        data: body,
      });

      revalidatePath("/dashboard/profile");

      return c.json(user);
    },
  )
  .put(
    "/:id/admin",
    zValidator(
      "json",
      z.object({
        user: z.object({
          name: z.string().nullish(),
        }),
      }),
    ),
    async (c) => {
      await checkAdminPermissions();

      const body = c.req.valid("json");
      const id = c.req.param("id");

      const user = await prisma.user.update({
        where: { id },
        data: {
          name: body.user.name,
        },
      });

      return c.json(user);
    },
  );
