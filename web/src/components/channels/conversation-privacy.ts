import type { MentorRequest } from "@/lib/platform/contracts";
import { CONDUCT_PATH } from "@/lib/platform/server/space-routes";
import { dayLabel, firstName } from "./channel-format";

/*
 * What a private conversation's header says about who reads it, and when its
 * request was asked and accepted (QA4-08, QA4-16, QA4-17). Pure, so each line
 * is tested on its own. Every word is true of the server: only the two
 * members read a DIRECT conversation (channelAccessFor), and an admin outside
 * it sees one message only, once a member reports it or a check flags or
 * hides it, never the rest (QA4-01).
 */

/** "Only you and David can read this", the header's visible line. */
export function conversationReaders(counterpartName: string | null): string {
  const other = counterpartName?.trim();
  return other ? `Only you and ${firstName(other)} can read this` : "Only the two of you can read this";
}

/** Behind the line: what TTV admins can see, and only that. */
export const CONVERSATION_ADMIN_NOTE =
  "TTV admins see a message here only if one of you reports it or our checks flag it, and then only that message.";

/** Where the code of conduct says who reads what. */
export const CONVERSATION_READERS_HREF = `${CONDUCT_PATH}#conduct-audience`;

/** "today", "yesterday", "on Saturday", "on 13 Oct": a day inside a phrase. */
function onDay(timestamp: number, now: number): string {
  const label = dayLabel(timestamp, now);
  return label === "Today" || label === "Yesterday" ? label.toLowerCase() : `on ${label}`;
}

export type ConversationTimeline =
  | { sameDay: true; text: string }
  | { sameDay: false; asked: string; accepted: string };

/**
 * When the request was asked and when it was accepted, said apart from what
 * was asked for, so "a 30-minute call today" never reads as the call's day
 * (QA4-16). The note opens the conversation timed at the acceptance, so the
 * day it was asked shows here (QA4-17). `updatedAt` is the acceptance: an
 * accepted request does not change again.
 */
export function conversationTimeline(request: Pick<MentorRequest, "createdAt" | "updatedAt">, now: number): ConversationTimeline {
  const asked = onDay(request.createdAt, now);
  const accepted = onDay(request.updatedAt, now);
  return asked === accepted ? { sameDay: true, text: `Asked and accepted ${accepted}` } : { sameDay: false, asked: `Asked ${asked}`, accepted: `accepted ${accepted}` };
}
