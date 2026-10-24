import type { StagingFixtureIdentity } from "@/lib/staging-fixtures";
import { hasMatchingRequestOrigin } from "@/lib/admin/mutation-security";
import { CommunityError } from "./model";
import { createCommunityService, type CommunityService } from "./service";
import { assessCommunityProfile } from "./assessment-ai";
import { createAssessmentProvider, type AssessmentOutputReason } from "./assessment-provider";
import { stagingAssessmentProbe } from "./staging-assessment-probe";
import { runCommunityChat } from "./chat";

export function communityJson(body: unknown, status = 200) {
  return Response.json(body, { status, headers: { "Cache-Control": "no-store", Vary: "Cookie, Authorization" } });
}
interface Actor { id: string; scopes: readonly string[] | null; delegatedSession?: boolean; fixture?: StagingFixtureIdentity | null }
interface RouteContext { request: Request; path: string; actor: Actor; service: CommunityService; body: unknown; db: D1Database; env?: Env }
type Handler = (ctx: RouteContext) => Promise<Response>;

function requireBrowser(actor: Actor, admin = false) {
  if (actor.scopes !== null) throw new CommunityError("Use a browser session to manage access or review mentorship.",403);
  if (!actor.delegatedSession) return;
  const personas = admin ? ["admin"] : ["mentor","admin"];
  if (actor.fixture && personas.includes(actor.fixture.persona)) return;
  throw new CommunityError("Use a browser session to manage access or review mentorship.",403);
}
async function readBody(request: Request) {
  if (["GET", "HEAD", "DELETE"].includes(request.method)) return undefined;
  const reader = request.body?.getReader();
  if (!reader) throw new CommunityError("Send a JSON object.");
  const decoder = new TextDecoder();
  let text = "";
  let bytes = 0;
  try {
    while (true) {
      const chunk = await reader.read();
      if (chunk.done) break;
      bytes += chunk.value.byteLength;
      if (bytes > 32_000) { await reader.cancel(); throw new CommunityError("Request too large.",413); }
      text += decoder.decode(chunk.value,{stream:true});
    }
    text += decoder.decode();
  } finally { reader.releaseLock(); }
  try { return JSON.parse(text) as unknown; } catch { throw new CommunityError("Send a JSON object."); }
}
function authorizeRequest(request: Request, path: string, actor: Actor) {
  const write = !["GET", "HEAD"].includes(request.method);
  if (write && (actor.scopes === null || request.headers.has("Origin")) && !hasMatchingRequestOrigin(request)) throw new CommunityError("A same-origin request is required.", 403);
  const parts = path.split("/");
  const institution = parts[0] === "profiles" && (parts.length === 1 || parts[1] !== actor.id);
  const changesData = write && path !== "chat" && !path.endsWith("/assessment");
  const scope = institution ? "institution:read" : changesData ? "community:write" : "community:read";
  if (actor.scopes !== null && !actor.scopes.includes(scope)) throw new CommunityError("Insufficient token scope.", 403);
}
const routes: Record<string, Handler> = {
  "GET profile": async ({service}) => communityJson({profile: await service.getOwnProfile()}),
  "PUT profile": async ({service,body}) => communityJson({profile: await service.updateOwnProfile(body)}),
  "GET access": async ({service}) => communityJson(await service.access()),
  "POST access": async ({service,actor,body}) => { requireBrowser(actor,true); return communityJson(await service.setAccess(body)); },
  "GET mentorship": async ({service,actor}) => { requireBrowser(actor); return communityJson({entries: await service.listMentorship()}); },
  "GET journey": async ({service}) => communityJson({entries: await service.listJourney()}),
  "POST journey": async ({service,body}) => communityJson({entry: await service.createJourney(body)},201),
  "GET profiles": async ({service,request}) => {
    const url = new URL(request.url);
    return communityJson({profiles: await service.searchProfiles({query: url.searchParams.get("query") ?? "",limit:Number(url.searchParams.get("limit") ?? 20),skills:(url.searchParams.get("skills") ?? "").split(",").map(s=>s.trim()).filter(Boolean)})});
  },
  "POST chat": async ({service,body,env,actor}) => {
    // The first-party chat can perform multiple tools; require the matching delegated read scope.
    if (actor.scopes !== null && !actor.scopes.includes("community:read")) throw new CommunityError("Community read scope required.",403);
    if (!env) throw new CommunityError("Chat is unavailable.",503);
    const access = await service.access();
    if ((access.isInstitution || access.isAdmin) && actor.scopes !== null && !actor.scopes.includes("institution:read")) throw new CommunityError("Institution read scope required.",403);
    return communityJson(await runCommunityChat(env,service,body));
  },
};
async function journeyMutation(ctx: RouteContext,id: string) {
  if (ctx.request.method === "PUT") return communityJson(await ctx.service.updateJourney(id,ctx.body));
  if (ctx.request.method === "PATCH") return communityJson(await ctx.service.setJourneyVisibility(id,ctx.body));
  if (ctx.request.method === "DELETE") return communityJson(await ctx.service.deleteJourney(id));
  return communityJson({error:"Route not found."},404);
}
async function dynamicRoute(ctx: RouteContext) {
  const parts = ctx.path.split("/");
  if (parts[0] === "journey" && parts.length === 2) return journeyMutation(ctx,parts[1]);
  if (parts[0] === "journey" && parts[2] === "confirmations" && parts.length === 3 && ctx.request.method === "POST") {
    requireBrowser(ctx.actor);
    return communityJson({confirmation: await ctx.service.confirmJourney(parts[1],ctx.body)},201);
  }
  if (parts[0] !== "profiles" || parts.length < 2) return communityJson({error:"Route not found."},404);
  if (parts.length === 2 && ctx.request.method === "GET") return communityJson({profile: await ctx.service.getProfile(parts[1]),entries: await ctx.service.listJourney(parts[1])});
  if (parts.length === 3 && parts[2] === "assessment" && ctx.request.method === "POST") {
    const probe = stagingAssessmentProbe(ctx.db, ctx.env?.DEPLOYMENT_ENVIRONMENT, ctx.actor);
    const measurement: { claimed: boolean; payloadBytes: number; payloadCharacters: number; outputReason?: AssessmentOutputReason } = { claimed: false, payloadBytes: 0, payloadCharacters: 0 };
    const provider = createAssessmentProvider(ctx.env, probe ? { syntheticProbe: {
      reportInvalidOutput: reason => { measurement.outputReason = reason; },
      claim: async (size: { payloadBytes: number; payloadCharacters: number }) => {
        await probe.claim();
        Object.assign(measurement, { claimed: true, payloadBytes: size.payloadBytes, payloadCharacters: size.payloadCharacters });
      },
    } } : undefined);
    const assessment = await assessCommunityProfile(ctx.env,ctx.service,parts[1],ctx.body,provider);
    return communityJson({assessment, ...(probe ? {probe: measurement} : {})});
  }
  return communityJson({error:"Route not found."},404);
}
export async function handleCommunityRequest(request: Request, path: string, actor: Actor | null, db: D1Database, env?: Env) {
  if (!actor) return communityJson({error:"Sign in to continue."},401);
  if (request.headers.has("Authorization") && actor.scopes === null) return communityJson({error:"Scoped personal access token required."},401);
  try {
    authorizeRequest(request,path,actor);
    const ctx = {request,path,actor,service:createCommunityService(db,actor.id,actor.fixture,env?.DEPLOYMENT_ENVIRONMENT),body:await readBody(request),db,env};
    const route = routes[`${request.method} ${path}`];
    return route ? await route(ctx) : await dynamicRoute(ctx);
  } catch (error) {
    if (error instanceof CommunityError) return communityJson({error:error.message},error.status);
    return communityJson({error:"The community request could not be completed."},500);
  }
}
