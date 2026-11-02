import type {
  Channel, Message, MessageVersionCause, ModerationActionKind, ModerationQueueItem, ModerationQueueState,
} from "@/lib/platform/contracts";
import { channelPath } from "@/components/channels/paths";

/*
 * What one case in the admin moderation queue says, and which decisions it offers (U-2.4,
 * PLAN.md §10, screens/08). Pure: the card renders this, and the tests read it without a page.
 *
 * A case is B-2.5's queue item: evidence, the author's review request and the decision ride on it.
 */

export const MODERATION_PATH = "/admin/moderation";

export type ModerationCase = ModerationQueueItem;

/** One button in a case's decision form. */
export interface DecisionOption { action: ModerationActionKind; label: string }

/**
 * What a person can decide. A visible message (flagged or reported) is either fine as it is or
 * hidden; a hidden one stays hidden or comes back. Both buttons carry the same weight: the queue
 * does not suggest an answer. A decided case can be reversed with the one opposite decision.
 */
export function decisionOptions(item: Pick<ModerationCase, "state" | "message">): DecisionOption[] {
  const hidden = item.message.moderation?.state === "HIDDEN";
  // A deleted message is gone for everyone: there is nothing to hide, only the case to close, with
  // keep. B-2.5 refuses every decision on a deleted message that is still hidden (keep: hidden;
  // restore and hide: deleted), so that case offers none rather than a button that always fails.
  if (item.message.deleted) return item.state === "DECIDED" || hidden ? [] : [{ action: "keep", label: "Close the case" }];
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

/** Why a waiting case offers no decision: its author deleted the message while it was hidden. */
export function undecidableNote(item: Pick<ModerationCase, "state" | "message">): string | null {
  return item.state === "PENDING" && decisionOptions(item).length === 0
    ? "Its author deleted this message while it was hidden, so no one sees it. This case can't be closed from here yet."
    : null;
}

/** Where the message stands for the people in its channel right now. */
export function visibilityLabel(message: Pick<Message, "deleted" | "moderation">): string {
  if (message.deleted) return "deleted by its author";
  return message.moderation?.state === "HIDDEN" ? "hidden from members" : "still visible";
}

export const CHANNEL_KIND_LABEL: Record<Channel["kind"], string> = {
  COMMUNITY: "Community",
  COHORT: "Cohort",
  DIRECT: "Direct message",
};

/**
 * The message in its channel: replies open their thread. Null for a kind with no page yet
 * (direct conversations arrive in Phase 4).
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

/** The banner after a decision. It says what changed for the channel, never more. */
export const DECIDED_NOTICE: Record<ModerationActionKind, string> = {
  hide: "Hidden. Members no longer see the message. Its author is told and can ask for a review.",
  restore: "Restored. Everyone in the channel sees the message again.",
  keep: "Kept as is. Nothing is hidden, and the same text won't be flagged again.",
};

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

/** When something happened, in Nairobi time where most members are: "1 Nov 2026, 14:05". */
export function formatModerationTime(at: number): string {
  return nairobiTime.format(new Date(at));
}
