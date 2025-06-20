import { Hono } from "hono";
// We avoid the Vercel-specific adapter so the same code can run anywhere.
// Hono's apps implement a standard `fetch` handler that works in Node
// and edge runtimes alike, so we simply call `app.fetch` directly.
import { programApplicationHandler } from "./program-application/program-application";
import { programPartnerHandler } from "./program-partner/program-partner";
import { userHandler } from "./user/user";
import { programRoleHandler } from "./program-role/program-role";

export const runtime = "nodejs";

const app = new Hono()
  .basePath("/api/v1")
  .route("/program-application", programApplicationHandler)
  .route("/program-partner", programPartnerHandler)
  .route("/program-role", programRoleHandler)
  .route("/user", userHandler);

const handler = (req: Request) => app.fetch(req);

export const GET = handler;
export const POST = handler;
export const PUT = handler;
export const PATCH = handler;
export const DELETE = handler;
export const HEAD = handler;
export const OPTIONS = handler;

export type AppType = typeof app;
