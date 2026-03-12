"use server";

import { getServerSession } from "@/modules/auth/lib/get-server-session/get-server-session";
import { prisma } from "@/modules/prisma/lib/prisma-client/prisma-client";
import { s3Client } from "@/modules/s3/client";
import { DeleteObjectCommand, PutObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";

const bucket = "ttv-application-files";
const maxFileSize = 2 * 1024 * 1024; // 2MB

export interface FileUploadResult {
  url: string;
  id: string;
  filename: string;
}

export async function getFileUploadUrl(data: {
  filename: string;
  mimeType: string;
  size: number;
}): Promise<FileUploadResult> {
  const session = await getServerSession();
  if (!session?.user?.id) throw new Error("Unauthorized");

  const userId = session.user.id;
  const { filename, mimeType, size } = data;

  if (size > maxFileSize) {
    throw new Error("File size exceeds the maximum allowed size");
  }

  const timestamp = new Date().getTime();
  const newFilename = `${timestamp}-${filename}`;
  const path = `${userId}/${newFilename}`;

  const file = await prisma.file.create({
    data: {
      path,
      size,
      ownerId: userId,
      type: mimeType,
      name: newFilename,
    },
  });

  const url = await getSignedUrl(
    s3Client,
    new PutObjectCommand({
      Bucket: bucket,
      Key: path,
      ContentType: mimeType,
      ContentLength: size,
    }),
  );

  return { url, id: file.id, filename: newFilename };
}

export async function deleteFile(fileId: string) {
  const session = await getServerSession();
  if (!session?.user?.id) throw new Error("Unauthorized");

  const file = await prisma.file.findUnique({
    where: { id: fileId, ownerId: session.user.id },
  });

  if (!file) throw new Error("File not found");

  await s3Client.send(
    new DeleteObjectCommand({
      Bucket: bucket,
      Key: file.path,
    }),
  );
}
