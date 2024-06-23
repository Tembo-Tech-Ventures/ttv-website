import { createId } from "@paralleldrive/cuid2";
import { headers } from "next/headers";

export function GET() {
  headers();
  const id = createId();
  const response = new Response(id, {
    headers: {
      "content-type": "text/plain",
    },
  });
  return response;
}
