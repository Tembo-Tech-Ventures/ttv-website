import type { APIRoute } from "astro";
import { env } from "cloudflare:workers";

const MODEL = "@cf/cloudflare/clef-flash";

type ClefProbeResponse = {
  model?: unknown;
  answers?: Record<string, unknown>;
  usage?: unknown;
};

function summarizeResult(result: ClefProbeResponse) {
  const answer = result.answers?.contains_contact_details as
    | { type?: unknown; noul?: unknown }
    | undefined;
  const probabilityIsUnitInterval =
    typeof answer?.noul === "number" && answer.noul >= 0 && answer.noul <= 1;
  const hasUsage = typeof result.usage === "object" && result.usage !== null;
  const valid =
    typeof result.model === "string" &&
    answer?.type === "noul" &&
    probabilityIsUnitInterval &&
    hasUsage;

  return {
    valid,
    model: result.model,
    answerType: answer?.type,
    probabilityIsUnitInterval,
    hasUsage,
  };
}

export const POST: APIRoute = async ({ locals }) => {
  if (!locals.user || !locals.isAdmin) {
    return Response.json({ error: "Forbidden" }, { status: 403 });
  }

  const deploymentEnvironment = env.DEPLOYMENT_ENVIRONMENT?.trim() ?? "";
  if (!deploymentEnvironment.startsWith("agent-")) {
    return Response.json({ error: "Preview only" }, { status: 403 });
  }

  const gatewayName = env.AI_GATEWAY_NAME?.trim();
  const result = (await env.AI.run(
    MODEL as Parameters<typeof env.AI.run>[0],
    ({
      model: "clef-flash",
      state: {
        name: "Preview Builder",
        bio: "I build community software and share what I learn.",
      },
      questions: {
        contains_contact_details: {
          type: "noul",
          instructions:
            "Does any public profile text contain a phone number, email address, or national identity number?",
        },
      },
    } as never),
    gatewayName ? { gateway: { id: gatewayName } } : undefined
  )) as ClefProbeResponse;
  const summary = summarizeResult(result);

  return Response.json(
    summary,
    { status: summary.valid ? 200 : 502 }
  );
};
