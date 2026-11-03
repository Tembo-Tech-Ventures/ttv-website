import { communityActor } from "./actor";
import { handleCommunityRequest } from "./http";
import { handleQaCommunityRequest } from "./staging-persona-qa";

/**
 * What /api/community/[...path] answers: a staging QA persona's checked call,
 * or the community API for the signed-in actor. Pages that render community
 * data on the server read it through here too, so they pass the same sign-in,
 * token-scope and access checks as the API.
 */
export function communityResponse(request: Request, path: string, locals: App.Locals, env: Env) {
  return locals.stagingQa
    ? handleQaCommunityRequest(request, path, locals.stagingQa, env)
    : handleCommunityRequest(request, path, communityActor(locals), env.DB, env);
}
