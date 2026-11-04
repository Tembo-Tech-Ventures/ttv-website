import type { APIRoute } from "astro";
import { env } from "cloudflare:workers";
import { handleSamLogin } from "@/lib/sam-login/login";

/** SAM agents sign in as fictional staging personas (src/lib/sam-login/README.md). 404 unless enabled on staging. */
export const ALL: APIRoute = ({ request }) => handleSamLogin(env, request);
