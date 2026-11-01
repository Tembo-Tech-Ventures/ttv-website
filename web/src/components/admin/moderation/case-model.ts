import type {
  Channel, Message, ModerationActionKind, ModerationQueueItem, ModerationQueueState, PersonSummary,
} from "@/lib/platform/contracts";
import { channelPath } from "@/components/channels/paths";

/*
 * What one case in the admin moderation queue says, and which decisions it offers (U-2.4,
 * PLAN.md §10, screens/08). Pure: the card renders this, and the tests read it without a page.
 *
 * The case shape is B-2.5's contract change (feature.platform-spaces seq 379): evidence, the
 * author's review request and the decision ride on the queue item. Until that lands in
 * contracts.ts, ModerationCase spells the additions out here.
 */

export const MODERATION_PATH = "/admin/moderation";

export type MessageVersionCause = "EDIT" | "DELETE" | "FLAG" | "REPORT" | "HIDE";
export interface MessageVersion { body: string; cause: MessageVersionCause; capturedAt: number }
export interface ModerationReview { requestedAt: number; note: string | null }
export interface ModerationDecision {
  action: ModerationActionKind; reason: string; by: PersonSummary | null; decidedAt: number;
}
export type ModerationCaseSource = ModerationQueueItem["source"] | "ADMIN_HIDE";
export type ModerationCase = Omit<ModerationQueueItem, "source"> & {
  source: ModerationCaseSource;
  /** Earlier text, oldest first. Administrators only. */
  evidence: MessageVersion[];
  review: ModerationReview | null;
  /** Non-null exactly when the case is DECIDED. */
  decision: ModerationDecision | null;
};

/** One button in a case's decision form. */
export interface DecisionOption { action: ModerationActionKind; label: string }

/**
 * What a person can decide. A visible message (flagged or reported) is either fine as it is or
 * hidden; a hidden one stays hidden or comes back. Both buttons carry the same weight: the queue
 * does not suggest an answer. A decided case can be reversed with the one opposite decision.
 */
export function decisionOptions(item: Pick<ModerationCase, "state" | "message">): DecisionOption[] {
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
  keep: "Kept as is. The message stays visible, and the same text won't be flagged again.",
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
