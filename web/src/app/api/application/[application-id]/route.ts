import { getServerSession } from "@/modules/auth/lib/get-server-session/get-server-session";
import { prisma } from "@/modules/prisma/lib/prisma-client/prisma-client";
import { NextResponse } from "next/server";

export async function PUT(
  req: Request,
  { params }: { params: { "application-id": string } },
) {
  const userId = (await getServerSession())?.user?.id;

  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const applicationId = params["application-id"];

  if (!applicationId) {
    return NextResponse.json(
      { error: "Application ID is required" },
      { status: 400 },
    );
  }

  const body = await req.json();

  const application = await prisma.programApplication.update({
    where: {
      id: applicationId,
      userId: {
        equals: userId,
      },
    },
    data: {
      userId,
      application: body,
    },
  });

  return NextResponse.json(application, { status: 200 });
}
