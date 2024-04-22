import { getServerSession } from "@/modules/auth/lib/get-server-session/get-server-session";
import { prisma } from "@/modules/prisma/lib/prisma-client/prisma-client";
import { s3Client } from "@/modules/s3/client";
import { PutObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { NextResponse } from "next/server";

const bucket = "ttv-application-files";
const maxFileSize = 2 * 1024 * 1024; // 2MB in bytes

export interface FileUploadResponse {
  url: string;
  id: string;
  filename: string;
}

export async function POST(
  req: Request,
): Promise<NextResponse<FileUploadResponse | { error: string }>> {
  const session = await getServerSession();

  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const userId = session.user.id;
  const params = await req.json();
  const filename = params?.filename;
  const mimeType = params?.mimeType;
  const size = params?.size;
  const timestamp = new Date().getTime();
  const newFilename = `${timestamp}-${filename}`;
  const path = `${userId}/${newFilename}`;

  if (size > maxFileSize) {
    return NextResponse.json(
      { error: "File size exceeds the maximum allowed size" },
      { status: 400 },
    );
  }

  const file = await prisma.file.create({
    data: {
      path,
      size,
      ownerId: userId,
      type: mimeType,
      name: newFilename,
    },
  });

  try {
    const url = await getSignedUrl(
      s3Client,
      new PutObjectCommand({
        Bucket: bucket,
        Key: path,
        ContentType: mimeType,
        ContentLength: size,
      }),
    );
    return NextResponse.json({ url, id: file.id, filename: newFilename });
  } catch (err) {
    console.error(err);
    return NextResponse.json({ error: `${err}` }, { status: 500 });
  }
}
