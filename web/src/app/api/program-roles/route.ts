"use server";

import { getServerSession } from "@/modules/auth/lib/get-server-session/get-server-session";
import { prisma } from "@/modules/prisma/lib/prisma-client/prisma-client";
import { checkAdminPermissions } from "@/modules/roles/lib/check-admin-permissions/check-admin-permissions";
import { ProgramRoleName } from "@prisma/client";
import { NextResponse } from "next/server";
import { z } from "zod";

const postSchema = z.object({
  userId: z.string(),
  programId: z.string(),
  role: z.enum(["INSTRUCTOR", "TA"]),
});

export async function assignProgramRole(
  userId: string,
  programId: string,
  role: ProgramRoleName
) {
  if (!userId || !programId || !role) {
    throw new Error("Invalid form data");
  }

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

  return { success: true };
}

export async function POST(req: Request) {
  checkAdminPermissions();

  const body = await req.json();
  const parsedBody = postSchema.safeParse(body);

  if (!parsedBody.success) {
    return NextResponse.json(
      {
        error: "Invalid form data",
        details: parsedBody.error.errors,
      },
      { status: 400 }
    );
  }
  const { userId, programId, role } = parsedBody.data;

  await assignProgramRole(userId, programId, role);
  return NextResponse.json({ status: 201 });
}
