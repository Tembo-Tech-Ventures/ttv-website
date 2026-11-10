import type { ChipTone } from "./tones";

/**
 * Every status a person can see, by domain: the one name it goes by
 * everywhere, and its chip tone. The name is the same on the member's page
 * and the admin's, so `APPROVED` is "Accepted" wherever it appears. Tones
 * follow the chip rules: neutral for a state that is simply true, peach for
 * one that waits on a person, the status tones for an outcome.
 *
 * Keys are the stored values; status.test.ts holds each domain to its column
 * in the schema, so a new status cannot reach a page without a name.
 */
export const STATUSES = {
  /** programApplication.status */
  application: {
    PENDING: { label: "In review", tone: "peach" },
    APPROVED: { label: "Accepted", tone: "success" },
    REJECTED: { label: "Declined", tone: "danger" },
    AUDIT: { label: "Audit", tone: "neutral" },
    COMPLETED: { label: "Completed", tone: "success" },
  },
  /** access_request.status: asking for mentor or institution access. */
  access: {
    PENDING: { label: "In review", tone: "peach" },
    APPROVED: { label: "Accepted", tone: "success" },
    DECLINED: { label: "Declined", tone: "danger" },
    WITHDRAWN: { label: "Withdrawn", tone: "neutral" },
  },
  /** feedback.status: a note, as staff work on it. */
  feedback: {
    NEW: { label: "New", tone: "peach" },
    IN_PROGRESS: { label: "In progress", tone: "neutral" },
    RESOLVED: { label: "Resolved", tone: "success" },
    DECLINED: { label: "Declined", tone: "neutral" },
  },
  /** feedback_theme.status */
  theme: {
    COLLECTING: { label: "Collecting", tone: "neutral" },
    PROPOSED: { label: "Proposed", tone: "peach" },
    PLANNED: { label: "Planned", tone: "neutral" },
    IN_PROGRESS: { label: "In progress", tone: "neutral" },
    SHIPPED: { label: "Shipped", tone: "success" },
    DECLINED: { label: "Declined", tone: "neutral" },
    DORMANT: { label: "Dormant", tone: "neutral" },
  },
  /**
   * A note as its author sees it, from the note and its theme (studentFeedbackState): the outcome,
   * never staff's workflow. Nothing in it waits on the student, so nothing is peach.
   */
  studentFeedback: {
    RECEIVED: { label: "Received", tone: "neutral" },
    PLANNED: { label: "Planned", tone: "neutral" },
    IN_PROGRESS: { label: "Being worked on", tone: "neutral" },
    DONE: { label: "Done", tone: "success" },
    NOT_PLANNED: { label: "Not planned", tone: "neutral" },
  },
  /** studentProfile.status. */
  profile: {
    DRAFT: { label: "Not on public website", tone: "neutral" },
    PUBLISHED: { label: "Published", tone: "success" },
    SUSPENDED: { label: "Suspended", tone: "danger" },
  },
  /** blogPost.status */
  post: {
    DRAFT: { label: "Draft", tone: "neutral" },
    PUBLISHED: { label: "Published", tone: "success" },
    SUSPENDED: { label: "Suspended", tone: "danger" },
  },
  /** profileContact.status: a visitor's message on a builder's public page. New waits on the builder. */
  contact: {
    NEW: { label: "New", tone: "peach" },
    READ: { label: "Read", tone: "neutral" },
    ARCHIVED: { label: "Archived", tone: "neutral" },
  },
  /** clientProject.status */
  project: {
    PENDING: { label: "In review", tone: "peach" },
    APPROVED: { label: "Accepted", tone: "success" },
    REJECTED: { label: "Declined", tone: "danger" },
    CLOSED: { label: "Closed", tone: "neutral" },
    MATCHED: { label: "Matched", tone: "success" },
  },
  /** recording.processingStatus */
  recording: {
    pending: { label: "Waiting", tone: "neutral" },
    queued: { label: "Queued", tone: "neutral" },
    downloading: { label: "Downloading", tone: "neutral" },
    extracting_audio: { label: "Extracting audio", tone: "neutral" },
    transcribing: { label: "Transcribing", tone: "neutral" },
    embedding: { label: "Indexing", tone: "neutral" },
    complete: { label: "Ready", tone: "success" },
    failed: { label: "Failed", tone: "danger" },
  },
  /** A personal access token, from its expiry and revocation. */
  token: {
    ACTIVE: { label: "Active", tone: "success" },
    EXPIRED: { label: "Expired", tone: "neutral" },
    REVOKED: { label: "Revoked", tone: "neutral" },
  },
} as const satisfies Record<
  string,
  Record<string, { label: string; tone: ChipTone }>
>;

export type StatusDomain = keyof typeof STATUSES;
export type StatusOf<D extends StatusDomain> = keyof (typeof STATUSES)[D] &
  string;
export type StatusLook = { label: string; tone: ChipTone };

/**
 * A status's name and tone. A value the map does not know (a row written by
 * a newer deploy) reads as itself in a neutral chip rather than breaking the
 * page; status.test.ts keeps that from happening for the stored values.
 */
export function statusTone<D extends StatusDomain>(
  domain: D,
  status: StatusOf<D>,
): StatusLook {
  const known = (STATUSES[domain] as Record<string, StatusLook>)[status];
  if (known) return known;
  const words = String(status).replace(/_/g, " ").toLowerCase();
  return {
    label: words.charAt(0).toUpperCase() + words.slice(1),
    tone: "neutral",
  };
}
