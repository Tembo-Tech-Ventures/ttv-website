/**
 * Image upload endpoint for the blog editor. Accepts multipart form uploads,
 * resizes them to a reasonable width and forwards to S3. Access is restricted
 * to administrators using the standard role-based permissions.
 */

import { NextRequest, NextResponse } from "next/server";
import { uploadImage } from "@/modules/blog/lib/upload-image/upload-image";
import { checkAdminPermissions } from "@/modules/roles/lib/check-admin-permissions/check-admin-permissions";

export async function POST(req: NextRequest) {
  try {
    await checkAdminPermissions();
  } catch {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const form = await req.formData();
  const file = form.get("file") as File | null;
  if (!file) {
    return NextResponse.json({ error: "file missing" }, { status: 400 });
  }
  const arrayBuffer = await file.arrayBuffer();
  const buffer = Buffer.from(arrayBuffer);
  const key = `${Date.now()}-${file.name}`;
  const url = await uploadImage({
    body: buffer,
    contentType: file.type,
    key,
  });
  return NextResponse.json({ url });
}
