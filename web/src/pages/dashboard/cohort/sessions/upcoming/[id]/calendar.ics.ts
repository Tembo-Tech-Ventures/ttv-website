import type { APIRoute } from "astro";
import { env } from "cloudflare:workers";
import { drizzle } from "drizzle-orm/d1";
import { sessionPageResponse } from "@/components/platform/sessions/page-responses";
import { SPACE_PAGE_PATHS } from "@/components/platform/spaces/sidebar";
import { ChannelError } from "@/lib/channels/errors";
import * as schema from "@/lib/db/schema";
import { calendarFile } from "@/lib/meetings/ics";
import { readSession } from "@/lib/meetings/sessions";
import { nairobiFields } from "@/lib/meetings/session-times";
import { getFlags } from "@/lib/platform/server/flags";
import { requestCapabilities } from "@/lib/platform/server/request-capabilities";

/**
 * "Add to calendar" for one cohort session (in-app calls P8): its .ics file, for everyone who can see
 * it (src/lib/meetings/ics.ts). There are no email reminders, so this is how a session reaches a
 * person's own calendar. While `meetings` is off for the caller, or for a session they can't see, it
 * is the same 404 as the pages beside it. Never cached: it is per person, and changes when a host moves
 * the date.
 */
export const GET: APIRoute = async ({ params, locals, url }) => {
  const user = locals.user;
  const id = params.id;
  if (!user || locals.personalAccessToken || !id) return sessionPageResponse(404);
  const [flags, capabilities] = await Promise.all([
    getFlags({ db: env.DB, env, user, locals }),
    requestCapabilities(drizzle(env.DB, { schema }), locals),
  ]);
  let session;
  try {
    session = await readSession(env.DB, { userId: user.id, capabilities, meetings: flags.meetings }, id, { host: false });
  } catch (error) {
    if (error instanceof ChannelError && error.status === 404) return sessionPageResponse(404);
    throw error;
  }
  const page = new URL(SPACE_PAGE_PATHS.sessions, url).toString();
  const body = calendarFile({
    id: session.id,
    title: session.title,
    description: `${session.cohortName} session on TTV. It's recorded. Join from Sessions: ${page}`,
    url: page,
    startAt: session.scheduledStartAt,
    minutes: session.bookedMinutes,
    now: Date.now(),
    sequence: Math.floor((session.updatedAt - session.createdAt) / 1000),
    cancelled: session.state === "CANCELLED",
  });
  return new Response(body, {
    headers: {
      "Content-Type": "text/calendar; charset=utf-8",
      "Content-Disposition": `attachment; filename="ttv-session-${nairobiFields(session.scheduledStartAt).date}.ics"`,
      "Cache-Control": "no-store",
      Vary: "Cookie",
    },
  });
};
