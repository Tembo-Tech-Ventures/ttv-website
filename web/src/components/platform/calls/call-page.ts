import type { NoteCheckEnv } from "@/lib/meetings/note-checks";
import { noteChecks } from "@/lib/meetings/note-checks";
import { callEvents } from "@/lib/meetings/call-events";
import type { CallCaller, CallsContext } from "@/lib/meetings/proposals";
import type { Me } from "@/lib/platform/contracts";
import type { PlatformCapabilities } from "@/lib/platform/server/capabilities";
import type { FlagContext } from "@/lib/platform/server/flags";
import { CALLS_PAGE_PATH, conversationRoute, CONVERSATION_PATH, proposalPath } from "@/lib/platform/server/space-routes";
import { ChannelError } from "@/lib/channels/errors";
import { CHANNEL_MESSAGES_ID } from "@/components/channels/paths";
import { sessionPageResponse } from "@/components/platform/sessions/page-responses";

/**
 * What the Calls pages share (in-app calls P10, src/lib/meetings/README.md, "Calls between two
 * people"): the caller as proposals.ts knows them, the context its writes take (the checks a new card
 * gets, and the other person's Attention, both after the response), and the bare refusals. Every
 * refusal is the same 404 the pages beside it give: the flag off, no such suggestion or call, or one
 * the caller is not in.
 */

/** The caller from the space context: `meeting_checkins` as effective for them, capabilities from the database. */
export const callerFor = (me: Me, capabilities: PlatformCapabilities): CallCaller => ({
  userId: me.user.id, capabilities, checkins: me.flags.meeting_checkins,
});

export function callsContext(
  env: NoteCheckEnv & FlagContext["env"],
  cfContext: Pick<ExecutionContext, "waitUntil"> | undefined,
  route: string,
  now: number,
): CallsContext {
  return { db: env.DB, now, afterNote: noteChecks(env, cfContext, route), afterEvent: callEvents(env, cfContext, now) };
}

/** Not found, or a method the page doesn't take; never cached. */
export const callPageResponse = sessionPageResponse;

/** A refusal that is the same 404 for everyone it isn't for, or null for one the page shows (a 409, a 400). */
export function hiddenRefusal(error: unknown): Response | null {
  if (!(error instanceof ChannelError)) throw error;
  return error.status === 404 ? callPageResponse(404) : null;
}

/** A conversation's page, where its cards are. */
export const conversationHref = (channelId: string) => `${CONVERSATION_PATH}/${encodeURIComponent(channelId)}`;

/** Where an answer goes back to: the conversation it came from (the card), the Calls page, or the suggestion's own page. */
export function answeredHref(from: string, channelId: string, proposalId: string): string {
  if (from === "conversation" && conversationRoute(conversationHref(channelId))) return `${conversationHref(channelId)}#${CHANNEL_MESSAGES_ID}`;
  if (from === "calls") return CALLS_PAGE_PATH;
  return proposalPath(proposalId);
}
