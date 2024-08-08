import { prisma } from "@/modules/prisma/lib/prisma-client/prisma-client";
import { checkAdminPermissions } from "@/modules/roles/lib/check-admin-permissions/check-admin-permissions";
import { zValidator } from "@hono/zod-validator";
import { Hono } from "hono";
import { z } from "zod";

const handler = new Hono()
  .post(
    "/",
    zValidator(
      "json",
      z
        .object({
          userId: z.string(),
          programId: z.string(),
          role: z.enum(["INSTRUCTOR", "TA"]),
        })
        .passthrough()
    ),
    async (c) => {
      checkAdminPermissions();

      const { userId, programId, role } = c.req.valid("json");

      const hasRole = await prisma.programRole.findFirst({
        where: {
          userId,
          programId,
        },
      });

      if (hasRole) {
        await prisma.programRole.update({
          where: {
            id: hasRole.id,
          },
          data: {
            name: role,
          },
        });
      } else {
        await prisma.programRole.create({
          data: {
            userId,
            programId,
            name: role,
          },
        });
      }
      return c.json({ message: "created" }, 201);
    }
  )
  .delete("/:id", async (c) => {
    checkAdminPermissions();

    const id = c.req.param("id");

    await prisma.programRole.delete({
      where: {
        id,
      },
    });

    return c.json({ message: "deleted" });
  });

export const programRoleHandler = handler;
