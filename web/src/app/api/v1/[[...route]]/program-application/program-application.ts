import { getServerSession } from "@/modules/auth/lib/get-server-session/get-server-session";
import { prisma } from "@/modules/prisma/lib/prisma-client/prisma-client";
import { zValidator } from "@hono/zod-validator";
import { Hono } from "hono";
import { revalidatePath } from "next/cache";
import { z } from "zod";

export const programApplicationHandler = new Hono().post(
  "/",
  zValidator(
    "json",
    z
      .object({
        partnerId: z.string(),
      })
      .passthrough(),
  ),
  async (c) => {
    const body = c.req.valid("json");

    const userId = (await getServerSession())?.user?.id;

    const application = await prisma.programApplication.create({
      data: {
        userId,
        application: body as any,
        partnerId: body.partnerId,
      },
    });

    revalidatePath("/dashboard/apply");

    return c.json(application, 201);
  },
);
