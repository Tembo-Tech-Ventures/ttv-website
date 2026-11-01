import { communityActor, requireBrowser } from "@/lib/community/actor";
import { CommunityError } from "@/lib/community/model";
import { createCommunityService } from "@/lib/community/service";
import { recordErrorInBackground } from "@/lib/observability/errors";

export interface AwaitingConfirmationContext {
  db: D1Database;
  env: { DEPLOYMENT_ENVIRONMENT?: string; PLATFORM_FLAGS_OVERRIDE?: string };
  locals: Pick<App.Locals, "user" | "session" | "personalAccessToken" | "stagingDemo" | "stagingFixture" | "stagingQa">
    & Partial<Pick<App.Locals, "cfContext">>;
}

/**
 * Shared contributions waiting for this mentor's confirmation, counted from
 * the rows the Confirm page lists and behind the same checks as its
 * `GET /api/community/mentorship`: the browser-session gate, mentor (or
 * admin) roles read from the database, and the synthetic-identity scopes.
 *
 * Null means "not known", never zero: a caller the Confirm page would refuse
 * gets no number, and callers must then avoid saying nothing is waiting.
 * Retained QA personas read the Confirm page through their own filtered
 * handler, which this does not reproduce, so they get null too. So does a
 * failed read: it is recorded, and every spaces page still renders.
 */
export async function awaitingConfirmation({ db, env, locals }: AwaitingConfirmationContext): Promise<number | null> {
  if (locals.stagingQa) return null;
  const actor = communityActor(locals);
  if (!actor) return null;
  try {
    requireBrowser(actor);
    const service = createCommunityService(db, actor.id, actor.fixture, env.DEPLOYMENT_ENVIRONMENT, env.PLATFORM_FLAGS_OVERRIDE);
    return await service.countAwaitingConfirmation();
  } catch (error) {
    if (!(error instanceof CommunityError)) {
      recordErrorInBackground(locals.cfContext, db, { source: "request", route: "mentoring:awaiting-confirmation", error, level: "warning" });
    }
    return null;
  }
}
