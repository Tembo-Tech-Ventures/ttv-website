import type { AstroGlobal } from "astro";
import { drizzle } from "drizzle-orm/d1";
import { CONDUCT_VERSION } from "@/lib/channels/conduct";
import { ChannelError } from "@/lib/channels/errors";
import * as schema from "@/lib/db/schema";
import type { ChannelKind } from "@/lib/platform/contracts";
import { capabilitiesFor } from "@/lib/platform/server/capabilities";
import { getFlags } from "@/lib/platform/server/flags";
import { CONDUCT_PATH, SPACE_PATHS, channelPagePath } from "@/lib/platform/server/space-routes";
import { getMeeting, PURPOSE_FLAG } from "./calls";
import { callProviderFor } from "./provider";
import type { CallRoomProps } from "./room-model";
import type { MeetingPurpose } from "./rules";

/**
 * The call room page's server side (`/dashboard/calls/:id`; README.md beside this file, "The room"):
 * who may open it, and everything the island needs to draw the pre-join page and the room. It sits
 * outside the space router, as the post editor does, so it checks its own flag and access: anyone the
 * call isn't for (flag off, signed out, a personal access token, a call they can't see, no such call)
 * gets the same 404 as every meeting route.
 */

type Env = Pick<Cloudflare.Env, "DB" | "DEPLOYMENT_ENVIRONMENT" | "PLATFORM_FLAGS_OVERRIDE">;

/** What the room reads beside the flags: the call's channel and cohort, its card, recording, hosts and the reader's conduct. */
interface RoomFacts {
  purpose: MeetingPurpose;
  channelId: string;
  kind: ChannelKind;
  slug: string;
  channelName: string;
  cohortName: string | null;
  messageId: string | null;
  recordingState: string | null;
  hostIds: string;
  conductAgreed: number;
}

/**
 * One read: the call's channel and cohort, its card message, its recording's state, everyone who
 * hosts it and whether the reader agreed to the code of conduct. Hosts are as meetingAccessFor says:
 * a cohort's instructors and TAs and admins for a session, both members of a conversation, admins and
 * mentors (the channel's moderators) for an event.
 */
async function readRoomFacts(db: D1Database, meetingId: string, userId: string): Promise<RoomFacts | null> {
  return db.prepare(`SELECT m.purpose, c.id AS channelId, c.kind, c.slug, c.name AS channelName, p.name AS cohortName, m.messageId,
      (SELECT state FROM meeting_recording WHERE meetingId = m.id) AS recordingState,
      (SELECT json_group_array(userId) FROM (
        SELECT pr.userId FROM programRole pr WHERE c.kind = 'COHORT' AND pr.programId = c.programId AND pr.name IN ('INSTRUCTOR', 'TA')
        UNION SELECT ur.userId FROM UserRoles ur JOIN Roles r ON r.id = ur.roleId
          WHERE (c.kind = 'COHORT' AND r.name = 'ADMIN') OR (c.kind = 'COMMUNITY' AND r.name IN ('ADMIN', 'MENTOR'))
        UNION SELECT cm.userId FROM channel_member cm WHERE c.kind = 'DIRECT' AND cm.channelId = c.id)) AS hostIds,
      EXISTS (SELECT 1 FROM channel_conduct WHERE userId = ?2 AND version >= ?3) AS conductAgreed
    FROM meeting m JOIN channel c ON c.id = m.channelId LEFT JOIN program p ON p.id = c.programId
    WHERE m.id = ?1`).bind(meetingId, userId, CONDUCT_VERSION).first<RoomFacts>();
}

function hostIdsOf(value: string): string[] {
  try {
    const parsed: unknown = JSON.parse(value);
    return Array.isArray(parsed) ? parsed.filter((id): id is string => typeof id === "string") : [];
  } catch {
    return [];
  }
}

/** Where people go from the end screens: the session list, the conversation, or the event's channel. */
function backOf(facts: RoomFacts, channelHref: string): CallRoomProps["back"] {
  switch (facts.kind) {
    case "COHORT": return { href: `${SPACE_PATHS.cohort}/sessions`, label: "Back to Sessions" };
    case "DIRECT": return { href: channelHref, label: "Back to the conversation" };
    case "COMMUNITY": return { href: channelHref, label: `Back to #${facts.slug}` };
  }
}

/** The island's props, or the same 404 for anyone the call isn't for. */
export async function resolveCallRoom(Astro: Pick<AstroGlobal, "locals" | "params">, env: Env, now = Date.now()): Promise<CallRoomProps | Response> {
  const notFound = () => new Response("Not found", { status: 404, headers: { "cache-control": "private, no-store" } });
  const user = Astro.locals.user;
  const meetingId = Astro.params.id;
  if (!user || Astro.locals.personalAccessToken || !meetingId) return notFound();
  // No isAdmin from locals: STAFF audiences and hosting read the ADMIN role from the database.
  const [flags, capabilities, facts] = await Promise.all([
    getFlags({ db: env.DB, env, user, locals: Astro.locals }),
    capabilitiesFor(drizzle(env.DB, { schema }), user),
    readRoomFacts(env.DB, meetingId, user.id),
  ]);
  if (!facts || !flags.meetings || !flags[PURPOSE_FLAG[facts.purpose]]) return notFound();
  const provider = callProviderFor(env);
  let meeting;
  try {
    // Brings a live call up to date first (ended at its limit, with no host), as the API does.
    meeting = await getMeeting({ db: env.DB, provider, now }, { userId: user.id, capabilities, flags }, meetingId);
  } catch (error) {
    if (error instanceof ChannelError && error.status === 404) return notFound();
    throw error;
  }
  const channelHref = channelPagePath({ id: facts.channelId, kind: facts.kind, slug: facts.slug });
  const place = facts.kind === "DIRECT" ? "your conversation" : `#${facts.slug}`;
  return {
    meeting,
    self: { userId: user.id, name: user.name, image: user.image ?? null },
    hostIds: hostIdsOf(facts.hostIds),
    cohortName: facts.kind === "COHORT" ? facts.cohortName : null,
    chat: { href: facts.messageId ? `${channelHref}?thread=${encodeURIComponent(facts.messageId)}` : channelHref, place },
    back: backOf(facts, channelHref),
    recordingRefused: facts.recordingState === "REFUSED",
    conductAgreed: facts.conductAgreed === 1,
    conductHref: CONDUCT_PATH,
    unavailable: provider === null,
    renderedAt: now,
  };
}
