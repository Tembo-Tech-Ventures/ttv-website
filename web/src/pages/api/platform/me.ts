import type { APIRoute } from "astro";
import { ROUTES } from "@/lib/platform/contracts";
import { getSpaceContext } from "@/lib/platform/server/space-context";
import { platformError, platformJson } from "@/lib/platform/server/http";

export const GET: APIRoute = async (context) => {
  try {
    return platformJson(ROUTES.getMe.response.parse(await getSpaceContext(context)));
  } catch (error) {
    if (error instanceof Response) return error;
    return platformError("server", "Could not load platform context.", 500);
  }
};
