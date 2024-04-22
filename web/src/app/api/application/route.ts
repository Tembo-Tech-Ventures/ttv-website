import { getServerSession } from "@/modules/auth/lib/get-server-session/get-server-session";
import { prisma } from "@/modules/prisma/lib/prisma-client/prisma-client";
import { revalidatePath } from "next/cache";
import { NextResponse } from "next/server";

export async function POST(req: Request) {
  const userId = (await getServerSession())?.user?.id;

  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await req.json();

  const application = await prisma.programApplication.create({
    data: {
      userId,
      application: body,
    },
  });

  revalidatePath("/dashboard/apply");

  return NextResponse.json(application, { status: 201 });
}
