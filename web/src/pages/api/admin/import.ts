import type { APIRoute } from "astro";
import { env } from "cloudflare:workers";
import { isAgentSession } from "@/lib/agent-auth";
import {
  LegacyImportValidationError,
  executeLegacyImport,
  isLegacyImportEnabled,
  legacyImportDisabledMessage,
} from "@/lib/admin/import";

const AGENT_IMPORT_FORBIDDEN_MESSAGE =
  "Temporary agent sessions cannot perform legacy imports.";

function jsonResponse(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "Cache-Control": "no-store",
      "Content-Type": "application/json; charset=utf-8",
    },
  });
}

export const POST: APIRoute = async ({ request, locals }) => {
  if (!locals.user) {
    return jsonResponse({ error: "Unauthorized" }, 401);
  }
  if (!locals.isAdmin) {
    return jsonResponse({ error: "Forbidden" }, 403);
  }

  const deploymentEnvironment = env.DEPLOYMENT_ENVIRONMENT;
  if (!isLegacyImportEnabled(deploymentEnvironment)) {
    return jsonResponse(
      { error: legacyImportDisabledMessage(deploymentEnvironment) },
      403
    );
  }

  if (isAgentSession(locals.session?.userAgent)) {
    return jsonResponse({ error: AGENT_IMPORT_FORBIDDEN_MESSAGE }, 403);
  }

  let payload: unknown;
  try {
    payload = await request.json();
  } catch {
    return jsonResponse(
      { error: "Invalid import payload: expected valid JSON." },
      400
    );
  }

  try {
    const result = await executeLegacyImport(env.DB, payload);
    return jsonResponse(result, 200);
  } catch (error) {
    if (error instanceof LegacyImportValidationError) {
      return jsonResponse({ error: error.message, code: error.code }, 400);
    }

    return jsonResponse(
      { error: "Legacy import failed without applying changes." },
      500
    );
  }
};
