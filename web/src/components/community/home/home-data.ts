import { communityResponse } from "@/lib/community/route";
import type { CommunityProfile, JourneyClaim } from "@/components/discovery/types";
import { parseOwnJourney, parseOwnWork } from "../community-client";

/**
 * Community's data, read while the page renders: the caller's own profile and
 * journey. Each read is the API's own GET of the same path, in process, with
 * the page request's headers, so the same sign-in, token-scope and access
 * checks apply. Null, never a rejection, when either read is refused or fails:
 * the page then says it could not load them.
 */
export async function loadCommunityHome(request: Request, locals: App.Locals, env: Env): Promise<CommunityProfile | null> {
  const read = async (path: string) => {
    const url = new URL(`/api/community/${path}`, request.url);
    const response = await communityResponse(new Request(url, { headers: request.headers }), path, locals, env);
    return response.ok ? ((await response.json()) as unknown) : undefined;
  };
  try {
    const [profile, journey] = await Promise.all([read("profile"), read("journey")]);
    return profile && journey ? parseOwnJourney(profile, journey) : null;
  } catch {
    return null;
  }
}

/**
 * The caller's own work, drafts and held pieces included, for the profile editor: the API's own GET
 * of journey, in process, as loadCommunityHome reads it. Null when it is refused or fails.
 */
export async function loadOwnWork(request: Request, locals: App.Locals, env: Env): Promise<JourneyClaim[] | null> {
  try {
    const url = new URL("/api/community/journey", request.url);
    const response = await communityResponse(new Request(url, { headers: request.headers }), "journey", locals, env);
    return response.ok ? parseOwnWork(await response.json()) : null;
  } catch {
    return null;
  }
}

/** A write the community API takes: its path under /api/community/, method and JSON body (none for DELETE). */
export interface CommunityWrite {
  path: string;
  method: "POST" | "PUT" | "PATCH" | "DELETE";
  body?: unknown;
}

/**
 * Sends one of the profile editor's form saves as the API's own JSON call, in process. The page's
 * request lends its cookies, authorization and origin, so the API's same-origin check sees the
 * browser's post, and nothing else of the form's body travels.
 */
export function sendCommunityWrite(request: Request, locals: App.Locals, env: Env, write: CommunityWrite): Promise<Response> {
  const headers = new Headers();
  for (const name of ["cookie", "authorization", "origin", "user-agent"]) {
    const value = request.headers.get(name);
    if (value !== null) headers.set(name, value);
  }
  const init: RequestInit = { method: write.method, headers };
  if (write.body !== undefined) {
    headers.set("content-type", "application/json");
    init.body = JSON.stringify(write.body);
  }
  const url = new URL(`/api/community/${write.path}`, request.url);
  return communityResponse(new Request(url, init), write.path, locals, env);
}
