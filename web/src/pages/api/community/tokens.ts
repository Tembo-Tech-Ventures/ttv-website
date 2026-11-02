import { z } from "zod";
import type { APIRoute } from "astro";
import { env } from "cloudflare:workers";
import { isAgentSession } from "@/lib/agent-auth";
import { hasMatchingRequestOrigin } from "@/lib/admin/mutation-security";
import { createCommunityService } from "@/lib/community/service";
import { createPersonalAccessToken, listPersonalAccessTokens, personalAccessTokenFamily, revokePersonalAccessToken } from "@/lib/personal-access-tokens";

const tokenInput = z.object({ label: z.string(), durationHours: z.union([z.literal(8), z.literal(24), z.literal(168), z.literal(720)]), scopes: z.array(z.enum(["community:read", "community:write", "institution:read"])).refine(scopes => scopes.includes("community:read")) }).strict();
const json = (data: unknown, status = 200) => new Response(JSON.stringify(data), { status, headers: { "Content-Type": "application/json", "Cache-Control": "no-store" } });
async function readTokenBody(request: Request): Promise<Record<string, unknown> | Response> {
  const reader = request.body?.getReader();
  if (!reader) return json({ error: "JSON body required" }, 400);
  const chunks: Uint8Array[] = [];
  let bytes = 0;
  try {
    while (true) {
      const chunk = await reader.read();
      if (chunk.done) break;
      bytes += chunk.value.byteLength;
      if (bytes > 8192) { await reader.cancel(); return json({ error: "Request too large" }, 413); }
      chunks.push(chunk.value);
    }
  } finally { reader.releaseLock(); }
  const buffer = new Uint8Array(bytes);
  let offset = 0;
  for (const chunk of chunks) { buffer.set(chunk, offset); offset += chunk.byteLength; }
  try {
    const value: unknown = JSON.parse(new TextDecoder().decode(buffer));
    const parsed = z.record(z.string(), z.unknown()).safeParse(value);
    if (!parsed.success) return json({ error: "Invalid input" }, 400);
    return parsed.data;
  } catch { return json({ error: "Invalid JSON" }, 400); }
}
/**
 * The owner's own tokens, from a browser session: lists and revokes every token but admin ones (so a
 * former admin can still find and revoke a channels token issued on the admin page), and issues
 * community tokens only.
 */
export const ALL: APIRoute = async ({ request, locals }) => {
  if (!locals.user) return json({ error: "Authentication required" }, 401);
  if (request.headers.has("Authorization") || locals.personalAccessToken || isAgentSession(locals.session?.userAgent)) return json({ error: "Browser cookie session required" }, 403);
  if (request.method === "GET") return json({ tokens: (await listPersonalAccessTokens(env.DB, locals.user.id)).filter(t => personalAccessTokenFamily(t.scopes) !== "admin") });
  if (!["POST", "DELETE"].includes(request.method)) return new Response(null, { status: 405, headers: { Allow: "GET, POST, DELETE" } });
  if (!hasMatchingRequestOrigin(request)) return json({ error: "Same-origin request required" }, 403);
  const body = await readTokenBody(request);
  if (body instanceof Response) return body;
  const input = body;
  if (request.method === "DELETE") {
    if (typeof input.id !== "string" || Object.keys(input).some(key => key !== "id")) return json({ error: "Token id required" }, 400);
    const tokens = await listPersonalAccessTokens(env.DB, locals.user.id);
    if (!tokens.some(t => t.id === input.id && personalAccessTokenFamily(t.scopes) !== "admin")) return json({ error: "Token not found" }, 404);
    return json({ revoked: await revokePersonalAccessToken(env.DB, locals.user.id, input.id) });
  }
  const parsed = tokenInput.safeParse(input);
  if (!parsed.success) return json({ error: "Invalid label, duration or community scopes" }, 400);
  const validated = parsed.data;
  if (validated.scopes.includes("institution:read") && !(await createCommunityService(env.DB, locals.user.id).access()).isInstitution) return json({ error: "Approved institutional access required" }, 403);
  try {
    return json(await createPersonalAccessToken({ db: env.DB, userId: locals.user.id, label: validated.label, durationHours: validated.durationHours, scopes: validated.scopes }), 201);
  } catch { return json({ error: "Token could not be created. Check label and active-token limit." }, 400); }
};
