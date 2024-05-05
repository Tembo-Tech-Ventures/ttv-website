import { prisma } from "@/modules/prisma/lib/prisma-client/prisma-client";
import { NextResponse } from "next/server";
import { createId } from "@paralleldrive/cuid2";

export function GET() {
  const id = createId();
  const response = new Response(id, {
    headers: {
      "content-type": "text/plain",
    },
  });
  return response;
}
