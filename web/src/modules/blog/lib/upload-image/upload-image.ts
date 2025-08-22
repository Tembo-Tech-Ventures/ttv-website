/**
 * upload-image.ts
 * ----------------
 * Handles image uploads for blog posts. The function receives an image buffer,
 * resizes it to a reasonable width and stores it on an S3 compatible bucket
 * (Tigris object storage in production). The resulting public URL is returned
 * to the caller.
 */

import { S3Client, PutObjectCommand } from "@aws-sdk/client-s3";
import sharp from "sharp";

interface UploadImageParams {
  /** Raw bytes of the uploaded image */
  body: Buffer;
  /** Original mime type of the upload */
  contentType: string;
  /** Destination file name (without path) */
  key: string;
}

const s3 = new S3Client({
  endpoint: process.env.S3_ENDPOINT,
  region: process.env.S3_REGION || "us-east-1",
  credentials: {
    accessKeyId: process.env.S3_ACCESS_KEY_ID || "",
    secretAccessKey: process.env.S3_SECRET_ACCESS_KEY || "",
  },
});

/**
 * Resizes an image to 1200px width (preserving aspect ratio) and uploads it to
 * the configured S3 bucket.
 */
export async function uploadImage({
  body,
  contentType,
  key,
}: UploadImageParams) {
  const resized = await sharp(body).resize({ width: 1200 }).toBuffer();
  const bucket = process.env.S3_BUCKET as string;
  await s3.send(
    new PutObjectCommand({
      Bucket: bucket,
      Key: key,
      Body: resized,
      ContentType: contentType,
    }),
  );
  const urlBase =
    process.env.S3_PUBLIC_BASE_URL || `https://${bucket}.s3.amazonaws.com`;
  return `${urlBase}/${key}`;
}
