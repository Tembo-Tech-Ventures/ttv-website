import { ChannelError } from "@/lib/channels/errors";
import type { Meeting } from "@/lib/platform/contracts";
import type { PlatformCapabilities } from "@/lib/platform/server/capabilities";
import { isProduction } from "@/lib/platform/server/flags";
import { callPath } from "@/lib/platform/server/space-routes";
import { SAM_PERSONA_PREFIX } from "@/lib/sam-login/personas";
import { meetingAccessFor } from "./access";
import { createMeeting, type Caller } from "./calls";
import type { CallContext } from "./clock";
import { CALL_LIMIT_MINUTES } from "./rules";
import { hostableCohorts } from "./sessions";

/**
 * Test calls (in-app calls T1; docs/meetings-testing.md): a short call that starts now, with the
 * caller as its host, so a check can fill a room and watch it end at its limit. Never a feature: the
 * page that makes one is a 404 in production whatever its settings, on staging unless
 * MEETINGS_TEST_CALLS is "on", and everywhere for anyone who hosts nowhere. A test call is an
 * ordinary call in every other way: the same access, seats, clock and room.
 */

export const TEST_CALL_PATH = "/dev/calls/test";
/** "A call ends on time" is checked with a call this long, unless the form asks for another length. */
export const TEST_CALL_DEFAULT_MINUTES = 2;
/** A test call is never longer than a real one. */
export const TEST_CALL_MAX_MINUTES = CALL_LIMIT_MINUTES;
export const TEST_CALL_DEFAULT_TITLE = "Test call";

/** An isolated agent preview's name (isAgentEnvironmentName in scripts/cloudflare/agent-preview-auth.mjs). */
const AGENT_PREVIEW = /^agent-[a-z0-9](?:[a-z0-9-]{0,32}[a-z0-9])?$/;

export type TestCallEnv = Pick<Cloudflare.Env, "DEPLOYMENT_ENVIRONMENT" | "MEETINGS_TEST_CALLS">;

/**
 * Whether test calls exist here: never in production (its own check first, so no variable or dev
 * build opens them there), in `astro dev`, on every agent preview, and on staging only while
 * MEETINGS_TEST_CALLS is "on" (scripts/cloudflare/lib.mjs sets it there alone, and only when asked).
 */
export function testCallsEnabled(env: TestCallEnv, { dev }: { dev: boolean }): boolean {
  if (isProduction(env)) return false;
  if (dev) return true;
  const environment = env.DEPLOYMENT_ENVIRONMENT ?? "";
  if (AGENT_PREVIEW.test(environment)) return true;
  return environment === "staging" && env.MEETINGS_TEST_CALLS === "on";
}

/** Somewhere a test call can be: a cohort's main channel (a session) or a community channel (an event). */
export interface TestCallPlace {
  channelId: string;
  purpose: "SESSION" | "EVENT";
  label: string;
}

/**
 * The places the caller hosts calls in: the cohorts they teach (every cohort for an admin) and the
 * community channels they moderate. On staging only the SAM personas' fictional cohorts are offered,
 * so a test session's card never lands in a real cohort's channel; an event posts no card.
 */
export async function testCallPlaces(db: D1Database, capabilities: PlatformCapabilities, env: TestCallEnv): Promise<TestCallPlace[]> {
  const staging = env.DEPLOYMENT_ENVIRONMENT === "staging";
  const [cohorts, community] = await Promise.all([
    hostableCohorts(db, capabilities),
    db.prepare(`SELECT id, slug, kind, programId, postingPolicy, archivedAt FROM channel
      WHERE kind = 'COMMUNITY' AND archivedAt IS NULL ORDER BY position, slug`).all<Record<string, unknown>>(),
  ]);
  return [
    ...cohorts
      .filter(({ programId }) => !staging || programId.startsWith(SAM_PERSONA_PREFIX))
      .map(({ name, channel }) => ({ channelId: channel.id, purpose: "SESSION" as const, label: `${name}: a session in #${channel.slug}` })),
    ...community.results
      .filter((row) => meetingAccessFor(capabilities, {
        kind: "COMMUNITY", programId: null, postingPolicy: row.postingPolicy as "ALL" | "STAFF", archivedAt: null,
      }, "EVENT").canHost)
      .map((row) => ({ channelId: row.id as string, purpose: "EVENT" as const, label: `Community: an event in #${row.slug as string}` })),
  ];
}

export interface TestCallRequest {
  channelId: string;
  title: string;
  minutes: number;
}

export interface TestCall {
  meeting: Meeting;
  /** The room, relative to the site: /dashboard/calls/:id. */
  roomPath: string;
}

/**
 * Makes a test call in one of `places`, starting now, booked and limited to `minutes`: it ends that
 * long after its host opens the room. A session is recorded as every session is (on the fake provider
 * nothing is); an event is not. A place the caller doesn't host is the same 404 as anything else.
 */
export async function createTestCall(
  ctx: CallContext, caller: Caller, places: readonly TestCallPlace[], { channelId, title, minutes }: TestCallRequest,
): Promise<TestCall> {
  const place = places.find((candidate) => candidate.channelId === channelId);
  if (!place) throw new ChannelError("not_found", "Not found.", 404);
  if (!Number.isInteger(minutes) || minutes < 1 || minutes > TEST_CALL_MAX_MINUTES) {
    throw new ChannelError("validation", `A test call lasts 1 to ${TEST_CALL_MAX_MINUTES} minutes.`, 400);
  }
  const named = title.trim().replace(/\s+/g, " ") || TEST_CALL_DEFAULT_TITLE;
  if (named.length > 120) throw new ChannelError("validation", "Keep the title to 120 characters.", 400);
  const scheduled = { channelId, title: named, scheduledStartAt: ctx.now, bookedMinutes: minutes };
  const meeting = await createMeeting(ctx, caller,
    place.purpose === "EVENT" ? { purpose: "EVENT", ...scheduled, record: false } : { purpose: "SESSION", ...scheduled },
    { limitMinutes: minutes });
  return { meeting, roomPath: callPath(meeting.id) };
}
