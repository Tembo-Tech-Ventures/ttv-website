import type { APIRoute } from "astro";
import { env } from "cloudflare:workers";
import { fakePresenceRequest } from "@/lib/meetings/http";

/** Who holds a seat, for the fake room client only: 404 wherever calls don't run on the fake provider. */
export const GET: APIRoute = (context) => fakePresenceRequest(context, env);
