import type { APIRoute } from "astro";
import { env } from "cloudflare:workers";
import { drizzle } from "drizzle-orm/d1";
import { callPageResponse } from "@/components/platform/calls/call-page";
import { ChannelError } from "@/lib/channels/errors";
import * as schema from "@/lib/db/schema";
import { calendarFile } from "@/lib/meetings/ics";
import { readBookedCall } from "@/lib/meetings/proposals";
import { nairobiFields } from "@/lib/meetings/session-times";
import { getFlags } from "@/lib/platform/server/flags";
import { requestCapabilities } from "@/lib/platform/server/request-capabilities";
import { bookedCallPath } from "@/lib/platform/server/space-routes";

/**
 * "Add to calendar" for one booked call between two people (in-app calls P10): its .ics file, for the
 * conversation's two members only (src/lib/meetings/ics.ts). There are no email reminders. The call's
 * id is the file's UID and its SEQUENCE rises with each change, so adding a moved call again replaces
 * the old entry, and a cancelled one says so. While `meeting_checkins` is off for the caller, or for a
 * call they aren't in, it is the same 404 as the pages beside it. Never cached: it is per person.
 */
export const GET: APIRoute = async ({ params, locals, url }) => {
  const user = locals.user;
  const id = params.id;
  if (!user || locals.personalAccessToken || !id) return callPageResponse(404);
  const [flags, capabilities] = await Promise.all([
    getFlags({ db: env.DB, env, user, locals }),
    requestCapabilities(drizzle(env.DB, { schema }), locals),
  ]);
  let call;
  try {
    call = await readBookedCall(env.DB, { userId: user.id, capabilities, checkins: flags.meeting_checkins }, id);
  } catch (error) {
    if (error instanceof ChannelError && error.status === 404) return callPageResponse(404);
    throw error;
  }
  const page = new URL(bookedCallPath(call.id), url).toString();
  const body = calendarFile({
    id: call.id,
    title: `${call.title} with ${call.counterpart.name}`,
    description: `A call on TTV between the two of you. Join it from TTV: ${page}`,
    url: page,
    startAt: call.scheduledStartAt,
    minutes: call.bookedMinutes,
    now: Date.now(),
    sequence: Math.floor((call.updatedAt - call.createdAt) / 1000),
    cancelled: call.state === "CANCELLED",
  });
  return new Response(body, {
    headers: {
      "Content-Type": "text/calendar; charset=utf-8",
      "Content-Disposition": `attachment; filename="ttv-call-${nairobiFields(call.scheduledStartAt).date}.ics"`,
      "Cache-Control": "no-store",
      Vary: "Cookie",
    },
  });
};
