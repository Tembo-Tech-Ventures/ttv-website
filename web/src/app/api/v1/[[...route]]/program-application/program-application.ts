import { getServerSession } from "@/modules/auth/lib/get-server-session/get-server-session";
import { prisma } from "@/modules/prisma/lib/prisma-client/prisma-client";
import { checkAdminPermissions } from "@/modules/roles/lib/check-admin-permissions/check-admin-permissions";
import { logProgramCompletion } from "@/modules/student-journey/lib/log-program-completion/log-program-completion";
import { zValidator } from "@hono/zod-validator";
import { ApplicationStatus } from "@prisma/client";
import { Hono } from "hono";
import { revalidatePath } from "next/cache";
import { z } from "zod";

export const programApplicationHandler = new Hono()
  .post(
    "/",
    zValidator(
      "json",
      z
        .object({
          name: z.string(),
          partnerId: z.string(),
        })
        .passthrough(),
    ),
    async (c) => {
      const body = c.req.valid("json");

      const userId = (await getServerSession())?.user?.id;

      if (!userId) {
        return c.json({ message: "Unauthorized" }, 401);
      }

      const name = body.name;

      await prisma.user.update({
        where: { id: userId },
        data: { name },
      });

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
  )
  .put(
    "/:id",
    zValidator(
      "json",
      z
        .object({
          name: z.string(),
          partnerId: z.string(),
        })
        .passthrough(),
    ),
    async (c) => {
      const body = c.req.valid("json");
      const id = c.req.param("id");

      const userId = (await getServerSession())?.user?.id;

      if (!userId) {
        return c.json({ message: "Unauthorized" }, 401);
      }

      const name = body.name;

      await prisma.user.update({
        where: { id: userId },
        data: { name },
      });

      const application = await prisma.programApplication.update({
        where: { id },
        data: {
          userId,
          application: body as any,
          partnerId: body.partnerId,
        },
      });

      revalidatePath(`/dashboard/apply/${id}`);

      return c.json(application, 200);
    },
  )
  // admin endpoint to update the status of an application
  .put(
    "/:id/admin",
    zValidator(
      "json",
      z
        // any object
        .object({
          programApplication: z.any(),
        })
        .passthrough(),
    ),
    async (c) => {
      checkAdminPermissions();
      const body = c.req.valid("json");
      const id = c.req.param("id");

      const application = await prisma.programApplication.update({
        where: { id },
        data: {
          ...body.programApplication,
        },
        include: { program: true },
      });

      if (application.status === ApplicationStatus.COMPLETED) {
        await logProgramCompletion(application);
      }

      return c.json(application, 200);
    },
  );
