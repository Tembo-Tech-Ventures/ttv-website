import { communityResponse } from "@/lib/community/route";
import { parseJourneyInitial, type JourneyInitial } from "./community-client";

/**
 * The journey view's first data, read while the page renders instead of by
 * three API calls after hydration (PERF-1 §3.8). Each read is the API's own
 * GET of the same path, in process, with the page request's headers, so the
 * same checks apply. Null, never a rejection, when any read is refused or
 * fails: the island then loads, and reports, exactly as it does without it.
 */
export async function loadJourneyInitial(request: Request, locals: App.Locals, env: Env): Promise<JourneyInitial | null> {
  const read = async (path: string) => {
    const url = new URL(`/api/community/${path}`, request.url);
    const response = await communityResponse(new Request(url, { headers: request.headers }), path, locals, env);
    return response.ok ? ((await response.json()) as unknown) : undefined;
  };
  try {
    const [access, profile, journey] = await Promise.all([read("access"), read("profile"), read("journey")]);
    return access && profile && journey ? parseJourneyInitial(access, profile, journey) : null;
  } catch {
    return null;
  }
}
