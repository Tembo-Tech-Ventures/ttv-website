import type { APIRoute } from "astro";
import { env } from "cloudflare:workers";
import { ROUTES } from "@/lib/platform/contracts";
import { recordErrorInBackground } from "@/lib/observability/errors";
import { getSpaceContext } from "@/lib/platform/server/space-context";
import { platformError, platformJson } from "@/lib/platform/server/http";

export const GET: APIRoute = async (context) => {
  try {
    return platformJson(await getSpaceContext(context));
  } catch (error) {
    if (error instanceof Response) return error;
    recordErrorInBackground(context.locals.cfContext, env.DB, {
      source: "request", route: ROUTES.getMe.path, error, version: env.DEPLOYMENT_VERSION,
    });
    return platformError("server", "Could not load platform context.", 500);
  }
};
