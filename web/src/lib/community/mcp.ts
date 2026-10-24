import { z } from "zod";
import { rubricInput } from "./assessment";
import { assessCommunityProfile } from "./assessment-ai";
import type { CommunityProfile, CommunityJourney } from "./model";
import { hasMatchingRequestOrigin } from "@/lib/admin/mutation-security";

export interface CommunityMcpService {
  getOwnProfile(): Promise<unknown>;
  updateOwnProfile(input: unknown): Promise<unknown>;
  searchProfiles(input: { query?: string; limit?: number; skills?: string[] }): Promise<unknown>;
  getProfile(userId: string): Promise<CommunityProfile>;
  listJourney(userId?: string): Promise<CommunityJourney[]>;
  access(): Promise<{ isInstitution: boolean }>;
}
export interface CommunityMcpActor {
  userId: string;
  /** null denotes a cookie session; an array denotes a scoped PAT. */
  scopes: readonly string[] | null;
}
const tools = [
  { name: "assess_profile", description: "AI assessment of documented evidence support1–5 per criterion; missing evidence is separate from low support, never ability or a hiring recommendation", inputSchema: { type: "object", properties: { userId: { type: "string" }, rubric: { type: "object", properties: { id: { type: "string" }, version: { type: "integer", minimum: 1 }, criteria: { type: "array", minItems: 1, maxItems: 10, items: { type: "object", properties: { id: { type: "string" }, label: { type: "string" }, terms: { type: "array", items: { type: "string" }, minItems: 1, maxItems: 10 }, contraryTerms: { type: "array", items: { type: "string" }, maxItems: 10 } }, required: ["id", "label", "terms"], additionalProperties: false } } }, required: ["id", "version", "criteria"], additionalProperties: false } }, required: ["userId", "rubric"], additionalProperties: false } },
  { name: "list_journey", description: "Read documented journey evidence", inputSchema: { type: "object", properties: { userId: { type: "string" } }, additionalProperties: false } },
  { name: "get_own_profile", description: "Read your own community profile", inputSchema: { type: "object", properties: {}, additionalProperties: false } },
  { name: "update_own_profile", description: "Update your own community profile", inputSchema: { type: "object", additionalProperties: true } },
  { name: "search_profiles", description: "Search discoverable community profiles as an approved institution", inputSchema: { type: "object", properties: { query: { type: "string" }, skills:{type:"array",maxItems:10,items:{type:"string",maxLength:60}}, limit: { type: "integer", minimum: 1, maximum: 50 } }, additionalProperties: false } },
  { name: "get_profile", description: "Read a discoverable community profile as an approved institution", inputSchema: { type: "object", properties: { userId: { type: "string" } }, required: ["userId"], additionalProperties: false } },
];
function response(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json", "Cache-Control": "no-store", "Vary": "Cookie, Authorization, Origin" } });
}
const rpcSchema = z.object({ jsonrpc: z.literal("2.0"), method: z.string(), id: z.union([z.string(), z.number(), z.null()]).optional(), params: z.unknown().optional() });
const callSchema = z.object({ name: z.enum(["get_own_profile", "update_own_profile", "search_profiles", "get_profile", "list_journey", "assess_profile"]), arguments: z.record(z.string(), z.unknown()).default({}) });
const searchSchema = z.object({ skills:z.array(z.string().trim().min(1).max(60)).max(10).optional(), query: z.string().max(2000).optional(), limit: z.number().int().min(1).max(50).optional() }).strict();
const targetSchema = z.object({ userId: z.string().min(1) }).strict();
const assessmentSchema = z.object({ userId: z.string().min(1), rubric: rubricInput }).strict();
const journeySchema = z.object({ userId: z.string().min(1).optional() }).strict();
function can(actor: CommunityMcpActor, scope: string): boolean { return actor.scopes === null || actor.scopes.includes(scope); }
function requiresInstitution(name: string, args: Record<string, unknown>, actor: CommunityMcpActor): boolean {
  if (name === "search_profiles") return true;
  if (!["get_profile", "list_journey", "assess_profile"].includes(name)) return false;
  return typeof args.userId === "string" && args.userId !== actor.userId;
}
async function executeTool(name: string, args: Record<string, unknown>, service: CommunityMcpService, env?: Env): Promise<unknown> {
  switch (name) {
    case "get_own_profile": z.object({}).strict().parse(args); return service.getOwnProfile();
    case "update_own_profile": return service.updateOwnProfile(args);
    case "search_profiles": return service.searchProfiles(searchSchema.parse(args));
    case "list_journey": return service.listJourney(journeySchema.parse(args).userId);
    case "assess_profile": {
      const { userId, rubric } = assessmentSchema.parse(args);
      return assessCommunityProfile(env, service, userId, rubric);
    }
    default: {
      const { userId } = targetSchema.parse(args);
      return { profile: await service.getProfile(userId), entries: await service.listJourney(userId) };
    }
  }
}
async function readBody(request: Request): Promise<string | null> {
  const reader = request.body?.getReader();
  const chunks: Uint8Array[] = [];
  let bytes = 0;
  if (reader) {
    try {
      while (true) {
        const chunk = await reader.read();
        if (chunk.done) break;
        bytes += chunk.value.byteLength;
        if (bytes > 64 * 1024) {
          await reader.cancel();
          return null;
        }
        chunks.push(chunk.value);
      }
    } finally { reader.releaseLock(); }
  }
  const buffer = new Uint8Array(bytes);
  let offset = 0;
  for (const chunk of chunks) { buffer.set(chunk, offset); offset += chunk.byteLength; }
  const text = new TextDecoder().decode(buffer);
  return text;
}
async function callTool(params: unknown, actor: CommunityMcpActor, service: CommunityMcpService, id: unknown, env?: Env): Promise<Response> {
  const fail = (code: number, message: string) => response({ jsonrpc: "2.0", id, error: { code, message } });
  const parsed = callSchema.safeParse(params);
  if (!parsed.success) return fail(-32602, "Invalid tool parameters");
  const { name, arguments: args } = parsed.data;
  const institutional = requiresInstitution(name, args, actor);
  let scope = "community:read";
  if (institutional) scope = "institution:read";
  if (name === "update_own_profile") scope = "community:write";
  if (!can(actor, scope)) return fail(-32003, "Insufficient token scope");
  try {
    if (institutional && !(await service.access()).isInstitution) return fail(-32003, "Approved institutional access required");
    const result = await executeTool(name, args, service, env);
    return response({ jsonrpc: "2.0", id, result: { content: [{ type: "text", text: JSON.stringify(result) }], structuredContent: { result } } });
  } catch (error) {
    if (error instanceof z.ZodError) return fail(-32602, "Invalid tool arguments");
    return response({ jsonrpc: "2.0", id, result: { isError: true, content: [{ type: "text", text: "Tool could not complete; access or input may be invalid." }] } });
  }
}
async function dispatchRpc(rpc: z.infer<typeof rpcSchema>, actor: CommunityMcpActor, service: CommunityMcpService, env?: Env): Promise<Response> {
  const id = rpc.id ?? null;
  const ok = (result: unknown) => response({ jsonrpc: "2.0", id, result });
  if (rpc.method === "notifications/initialized" && rpc.id === undefined) return new Response(null, { status: 202 });
  if (rpc.id === undefined) return response({ jsonrpc: "2.0", id, error: { code: -32600, message: "Request id required" } });
  switch (rpc.method) {
    case "initialize": return ok({ protocolVersion: "2025-11-25", capabilities: { tools: {} }, serverInfo: { name: "ttv-community", version: "1.0.0" } });
    case "ping": return ok({});
    case "tools/list": {
      const institutional = can(actor, "institution:read") && (await service.access()).isInstitution;
      const available = tools.filter(t => {
        if (t.name === "update_own_profile") return can(actor, "community:write");
        if (t.name === "assess_profile") return can(actor, "community:read") || institutional;
        if (["get_own_profile", "list_journey"].includes(t.name)) return can(actor, "community:read");
        return institutional;
      });
      return ok({ tools: available });
    }
    case "tools/call": return callTool(rpc.params, actor, service, id, env);
    default: return response({ jsonrpc: "2.0", id, error: { code: -32601, message: "Method not found" } });
  }
}
/** Stateless Streamable HTTP JSON response transport; GET returns 405 (no SSE). */
export async function handleCommunityMcp(request: Request, actor: CommunityMcpActor | null, service: CommunityMcpService, env?: Env): Promise<Response> {
  if (!actor) return response({ error: "Authentication required" }, 401);
  if ((actor.scopes === null || request.headers.has("Origin")) && !hasMatchingRequestOrigin(request)) return response({ error: "Same-origin request required" }, 403);
  if (request.method !== "POST") return new Response(null, { status: 405, headers: { Allow: "POST", "Cache-Control": "no-store" } });
  if (request.headers.get("content-type")?.split(";")[0].trim().toLowerCase() !== "application/json") return response({ error: "JSON required" }, 415);
  const version = request.headers.get("MCP-Protocol-Version");
  if (version && !["2025-03-26", "2025-11-25"].includes(version)) return response({ error: "Unsupported MCP protocol version" }, 400);
  const text = await readBody(request);
  if (text === null) return response({ error: "Request too large" }, 413);
  let value: unknown;
  try { value = JSON.parse(text); } catch { return response({ jsonrpc: "2.0", id: null, error: { code: -32700, message: "Parse error" } }); }
  const rpc = rpcSchema.safeParse(value);
  if (!rpc.success) return response({ jsonrpc: "2.0", id: null, error: { code: -32600, message: "Invalid Request" } });
  return dispatchRpc(rpc.data, actor, service, env);
}
