"use server";

/**
 * **File Upload Actions**
 *
 * These server actions provide a thin layer over AWS S3 for uploading and
 * deleting user files. They are consumed by the `FileUpload` component on the
 * client and enforce basic authorization and file size checks.
 *
 * Each exported function performs a single task:
 *  - `createUploadUrl` validates the request and returns a presigned URL for a
 *    direct S3 upload.
 *  - `deleteFile` ensures the current user owns the file before removing it from
 *    both S3 and the Prisma database.
 */

import { getServerSession } from "@/modules/auth/lib/get-server-session/get-server-session";
import { prisma } from "@/modules/prisma/lib/prisma-client/prisma-client";
import { s3Client } from "@/modules/s3/client";
import { DeleteObjectCommand, PutObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";

const bucket = "ttv-application-files";
const maxFileSize = 2 * 1024 * 1024; // 2MB

export interface FileUploadResponse {
  url: string;
  id: string;
  filename: string;
}

export async function createUploadUrl(params: {
  filename: string;
  mimeType: string;
  size: number;
}): Promise<FileUploadResponse> {
  const session = await getServerSession();
  const userId = session?.user?.id;
  if (!userId) throw new Error("Unauthorized");

  if (params.size > maxFileSize) {
    throw new Error("File size exceeds the maximum allowed size");
  }

  const timestamp = Date.now();
  const newFilename = `${timestamp}-${params.filename}`;
  const path = `${userId}/${newFilename}`;

  const file = await prisma.file.create({
    data: {
      path,
      size: params.size,
      ownerId: userId,
      type: params.mimeType,
      name: newFilename,
    },
  });

  const url = await getSignedUrl(
    s3Client,
    new PutObjectCommand({
      Bucket: bucket,
      Key: path,
      ContentType: params.mimeType,
      ContentLength: params.size,
    }),
  );

  return { url, id: file.id, filename: newFilename };
}

export async function deleteFile(id: string) {
  const session = await getServerSession();
  const ownerId = session?.user?.id;
  if (!ownerId) throw new Error("Unauthorized");

  const file = await prisma.file.findUnique({
    where: { id, ownerId },
  });
  if (!file) throw new Error("File not found");

  await s3Client.send(
    new DeleteObjectCommand({ Bucket: bucket, Key: file.path }),
  );

  await prisma.file.delete({ where: { id } });

  return { success: true } as const;
}
