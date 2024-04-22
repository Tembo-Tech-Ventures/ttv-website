import { getServerSession } from "@/modules/auth/lib/get-server-session/get-server-session";
import { prisma } from "@/modules/prisma/lib/prisma-client/prisma-client";
import { s3Client } from "@/modules/s3/client";
import { DeleteObjectCommand, PutObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { NextResponse } from "next/server";

const bucket = "ttv-application-files";

export async function POST(
  req: Request,
  { params }: { params: { "file-id": string } },
) {
  const session = await getServerSession();

  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const ownerId = session.user.id;
  const fileId = params["file-id"];

  const file = await prisma.file.findUnique({
    where: {
      id: fileId,
      ownerId,
    },
  });

  if (!file) {
    return NextResponse.json({ error: "File not found" }, { status: 404 });
  }

  try {
    const url = s3Client.send(
      new DeleteObjectCommand({
        Bucket: bucket,
        Key: file.path,
      }),
    );
    return NextResponse.json({ status: "deleted" });
  } catch (err) {
    console.error(err);
    return NextResponse.json({ error: err }, { status: 500 });
  }
}
