import { communityResponse } from "@/lib/community/route";
import type { CommunityProfile } from "@/components/discovery/types";
import { parseOwnJourney } from "../community-client";
import type { CommunityWrite } from "./home-forms";

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
 * Sends one of Community's form saves as the API's own JSON call, in process. The page's request
 * lends its cookies, authorization and origin, so the API's same-origin check sees the browser's
 * post, and nothing else of the form's body travels.
 */
export function sendCommunityWrite(request: Request, locals: App.Locals, env: Env, write: CommunityWrite): Promise<Response> {
  const headers = new Headers();
  for (const name of ["cookie", "authorization", "origin", "user-agent"]) {
    const value = request.headers.get(name);
    if (value !== null) headers.set(name, value);
  }
  headers.set("content-type", "application/json");
  const url = new URL(`/api/community/${write.path}`, request.url);
  return communityResponse(new Request(url, { method: write.method, headers, body: JSON.stringify(write.body) }), write.path, locals, env);
}
