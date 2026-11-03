import type {
  Channel, Message, MessageVersionCause, ModerationActionKind, ModerationQueueItem, ModerationQueueState,
} from "@/lib/platform/contracts";
import { excerpt, masksContactDetails, ZONE_LABEL } from "@/components/channels/channel-format";
import { channelPath } from "@/components/channels/paths";

/*
 * What one case in the admin moderation queue says, and which decisions it offers (U-2.4,
 * PLAN.md §10, screens/08). Pure: the card renders this, and the tests read it without a page.
 *
 * A case is B-2.5's queue item: evidence, the author's review request and the decision ride on it.
 */

export const MODERATION_PATH = "/admin/moderation";
/** Dispatched on the document with the waiting count after a decision swaps the queue in place. */
export const MODERATION_PENDING_EVENT = "ttv:moderation-pending";

export type ModerationCase = ModerationQueueItem;

/** One button in a case's decision form. */
export interface DecisionOption { action: ModerationActionKind; label: string }

/**
 * What a person can decide. A visible message (flagged or reported) is either fine as it is or
 * hidden; a hidden one stays hidden or comes back. Both buttons carry the same weight: the queue
 * does not suggest an answer. A decided case can be reversed with the one opposite decision.
 */
export function decisionOptions(item: Pick<ModerationCase, "state" | "message">): DecisionOption[] {
  // A deleted message is gone for everyone: there is nothing to hide or restore, only the case to
  // close. Keep does that in any state, hidden included, and changes nothing else (B-2.7).
  if (item.message.deleted) return item.state === "DECIDED" ? [] : [{ action: "keep", label: "Close the case" }];
  const hidden = item.message.moderation?.state === "HIDDEN";
  if (item.state === "DECIDED") {
    return hidden ? [{ action: "restore", label: "Restore" }] : [{ action: "hide", label: "Hide" }];
  }
  return hidden
    ? [{ action: "hide", label: "Keep hidden" }, { action: "restore", label: "Restore" }]
    : [{ action: "keep", label: "Fine as is" }, { action: "hide", label: "Hide" }];
}

/** Who raised the case, as the label above the message says it. */
export function sourceLabel(item: Pick<ModerationCase, "source" | "reportCount" | "actor" | "message">): string {
  switch (item.source) {
    case "AI_FLAG":
      return item.message.moderation?.state === "HIDDEN" ? "Hidden by Tembo" : "Flagged by Tembo";
    case "REPORT":
      return item.reportCount === 1 ? "Reported by 1 member" : `Reported by ${item.reportCount} members`;
    case "MENTOR_HIDE":
      return item.actor ? `Hidden by ${item.actor.name}` : "Hidden by a mentor";
    case "ADMIN_HIDE":
      return item.actor ? `Hidden by ${item.actor.name}` : "Hidden by an admin";
  }
}

/**
 * Where the message stands for the people in its channel right now. Flagged contact details are
 * masked for members until someone decides (QA2-08), so such a message is not "still visible".
 */
export function visibilityLabel(message: Pick<Message, "deleted" | "moderation">): string {
  if (message.deleted) return "deleted by its author";
  if (message.moderation?.state === "HIDDEN") return "hidden from members";
  return masksContactDetails(message.moderation) ? "contact details hidden from members" : "still visible";
}

export const CHANNEL_KIND_LABEL: Record<Channel["kind"], string> = {
  COMMUNITY: "Community",
  COHORT: "Cohort",
  DIRECT: "Direct conversation",
};

/**
 * Where the message was, as a sentence names it: "#opportunities", or "a direct conversation". A
 * direct conversation's case carries a stand-in channel with no real slug or name (QA4-01), so the
 * queue never shows one.
 */
export function channelReference(channel: Pick<Channel, "kind" | "slug">): string {
  return channel.kind === "DIRECT" ? "a direct conversation" : `#${channel.slug}`;
}

/** The line above the message: "Community · #opportunities · still visible", or "Direct conversation · hidden from members". */
export function caseContext(channel: Pick<Channel, "kind" | "slug">, message: Pick<Message, "deleted" | "moderation">): string {
  const where = channel.kind === "DIRECT" ? [] : [`#${channel.slug}`];
  return [CHANNEL_KIND_LABEL[channel.kind], ...where, visibilityLabel(message)].join(" · ");
}

/** Said under a direct conversation's case in place of a link: admins can't open the conversation. */
export const DIRECT_CASE_NOTE =
  "Only this message is shared with admins; the rest of the conversation stays private to its two members.";

/**
 * The message in its channel: replies open their thread. Null for a direct conversation: only its
 * two members can open it, so the case shows the message alone (DIRECT_CASE_NOTE).
 */
export function messageHref(channel: Pick<Channel, "kind" | "slug">, message: Pick<Message, "id" | "parentId">): string | null {
  const path = channelPath(channel);
  if (!path) return null;
  const query = new URLSearchParams();
  if (message.parentId) query.set("thread", message.parentId);
  query.set("message", message.id);
  return `${path}?${query.toString()}`;
}

export const EVIDENCE_CAUSE_LABEL: Record<MessageVersionCause, string> = {
  EDIT: "Before an edit",
  DELETE: "Before it was deleted",
  FLAG: "When it was flagged",
  REPORT: "When it was reported",
  HIDE: "When it was hidden",
};

export const DECISION_LABEL: Record<ModerationActionKind, string> = {
  hide: "Hidden",
  restore: "Restored",
  keep: "Kept as is",
};

/** What a decision did: one of the actions, or "closed", a keep on a deleted message, which only closes its case. */
export type DecidedOutcome = ModerationActionKind | "closed";

/** The banner after a decision. It says what changed for the channel, never more. */
export const DECIDED_NOTICE: Record<DecidedOutcome, string> = {
  // An admin's hide, or one an admin kept, is final: the author's review request is refused (`reviewable` false, QA2-14).
  hide: "Hidden. Members no longer see the message. Its author still sees it, with your reason, and that an admin's decision is final.",
  // Said of a channel and a direct conversation alike: whoever can read it, the two members of a conversation.
  restore: "Restored. Everyone who can read it sees the message again.",
  keep: "Kept as is. Nothing is hidden, and the same text won't be flagged again.",
  closed: "Case closed. Its author had deleted the message, so nothing else changes.",
};

/** How the decided tab names a decision: a keep on a deleted message only closed its case. */
export function decisionLabel(item: Pick<ModerationCase, "message"> & { decision: { action: ModerationActionKind } }): string {
  return item.message.deleted && item.decision.action === "keep" ? "Closed" : DECISION_LABEL[item.decision.action];
}

export const QUEUE_TABS: readonly { state: ModerationQueueState; label: string }[] = [
  { state: "PENDING", label: "Needs a decision" },
  { state: "DECIDED", label: "Decided" },
];

/** The first name, for "Dennis asked for a review". Names are free text, so fall back gently. */
export function firstName(name: string): string {
  return name.trim().split(/\s+/)[0] || "The author";
}

const nairobiTime = new Intl.DateTimeFormat("en-GB", {
  day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit", timeZone: "Africa/Nairobi",
});

/** When something happened, in Nairobi time where most members are, and saying so: "1 Nov 2026, 14:05 EAT" (QA2-13). */
export function formatModerationTime(at: number): string {
  return `${nairobiTime.format(new Date(at))} ${ZONE_LABEL}`;
}

/**
 * Which message a decision was about, for the banner after it (QA2-15): the author, the channel and
 * how the message starts. "Brian Kiprop's message in #show-your-work: “Has anyone…”".
 */
export function decidedSubject(item: Pick<ModerationCase, "message" | "channel">): string {
  const words = item.message.deleted ? "" : excerpt(item.message);
  return `${item.message.author.name}'s message in ${channelReference(item.channel)}${words ? `: “${words}”` : ""}`;
}
