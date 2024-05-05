import { getServerSession } from "@/modules/auth/lib/get-server-session/get-server-session";
import { prisma } from "@/modules/prisma/lib/prisma-client/prisma-client";
import { zValidator } from "@hono/zod-validator";
import { Hono } from "hono";
import { revalidatePath } from "next/cache";
import { z } from "zod";

export const userHandler = new Hono().put(
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
);
