import { communityActor, requireBrowser } from "@/lib/community/actor";
import { CommunityError } from "@/lib/community/model";
import { createCommunityReadService } from "@/lib/community/service";
import { ChannelError } from "@/lib/channels/errors";
import type { ErrorCode, WorthAnotherLook } from "@/lib/platform/contracts";
import { SPACE_REDIRECTS } from "@/lib/platform/server/space-routes";
import { personSummary } from "./people";

export interface WorthAnotherLookContext {
  db: D1Database;
  env: { DEPLOYMENT_ENVIRONMENT?: string; PLATFORM_FLAGS_OVERRIDE?: string };
  locals: Pick<
    App.Locals,
    | "user"
    | "session"
    | "personalAccessToken"
    | "stagingDemo"
    | "stagingFixture"
  >;
}

/** Where the Confirm page is: the canonical spaces path of the legacy /dashboard/mentorship. */
const CONFIRM_PATH =
  SPACE_REDIRECTS.find(([legacy]) => legacy === "/dashboard/mentorship")?.[1] ??
  "/dashboard/mentoring/confirm";

const CODES: Partial<Record<number, ErrorCode>> = {
  401: "forbidden",
  403: "forbidden",
  404: "not_found",
};

/**
 * GET /api/mentoring/another-look (B-4.2, README.md beside this file): the caller's confirmed work
 * that has changed revision since, through the Confirm page's own checks (createCommunityReadService):
 * the browser gate, mentor or admin roles from the database, and the synthetic-identity scopes. The
 * caller owns the `mentor_requests` flag. Owners carry no badges: the list is about the work.
 */
export async function worthAnotherLook({
  db,
  env,
  locals,
}: WorthAnotherLookContext): Promise<WorthAnotherLook> {
  const actor = communityActor(locals);
  if (!actor) throw new ChannelError("forbidden", "Not permitted.", 403);
  try {
    requireBrowser(actor);
    const service = createCommunityReadService(
      db,
      actor.id,
      actor.fixture,
      env.DEPLOYMENT_ENVIRONMENT,
      env.PLATFORM_FLAGS_OVERRIDE,
    );
    const rows = await service.listWorthAnotherLook();
    return {
      items: rows.map((row) => ({
        journeyId: row.journeyId,
        title: row.title.trim() || "Untitled project",
        owner: {
          ...personSummary(row.userId, {
            name: row.memberName,
            image: row.memberImage,
            roles: null,
          }),
          roleBadges: [],
        },
        confirmedVersion: row.confirmedVersion,
        currentVersion: row.currentVersion,
        href: CONFIRM_PATH,
      })),
    };
  } catch (error) {
    if (error instanceof CommunityError)
      throw new ChannelError(
        CODES[error.status] ?? "validation",
        error.message,
        error.status,
      );
    throw error;
  }
}
