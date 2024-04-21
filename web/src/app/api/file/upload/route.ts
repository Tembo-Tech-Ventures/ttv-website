import { s3Client } from "@/modules/s3/client";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { PutObjectCommand } from "@aws-sdk/client-s3";
import { NextResponse } from "next/server";
import { createReadStream } from "fs";
import { getServerSession } from "@/modules/auth/lib/get-server-session/get-server-session";

const bucket = "ttv-application-files";

export async function POST(req: Request) {
  const session = await getServerSession();

  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const user = session.user.id;
  const params = await req.json();
  const filename = params?.filename;
  const basePath = params?.basePath;
  const mimeType = params?.mimeType;
  const timestamp = new Date().getTime();
  const path = `${basePath}/${user}/${timestamp}-${filename}`;

  try {
    const url = await getSignedUrl(
      s3Client,
      new PutObjectCommand({
        Bucket: bucket,
        Key: path,
        ContentType: mimeType,
      }),
    );
    return NextResponse.json({ url });
  } catch (err) {
    console.error(err);
    return NextResponse.json({ error: err }, { status: 500 });
  }
}
