import { Hono } from "hono";
import { handle } from "hono/vercel";
import { programApplicationHandler } from "./program-application/program-application";
import { programPartnerHandler } from "./program-partner/program-partner";

export const runtime = "nodejs";

const app = new Hono()
  .basePath("/api/v1")
  .route("/program-application", programApplicationHandler)
  .route("/program-partner", programPartnerHandler);

export const GET = handle(app);
export const POST = handle(app);
export const PUT = handle(app);
export const PATCH = handle(app);
export const DELETE = handle(app);
export const HEAD = handle(app);
export const OPTIONS = handle(app);

export type AppType = typeof app;
