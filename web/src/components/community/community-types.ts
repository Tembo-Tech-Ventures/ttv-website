/**
 * The shapes the community client (community-client.ts) reads and sends, kept apart from any view so the
 * server pages that use the client (Community home, Discover, Confirm work) carry no island with them.
 */
import type { ClaimConfirmation } from "../discovery/types";

export interface EditableCommunityProfile {
  headline: string;
  bio: string;
  skills: string[];
  opportunityGoals: string;
}

export interface WorkIdentity {
  kind: import("@/lib/platform/contracts").WorkKind;
  repoFullName: string | null;
}

export interface ClaimDraft {
  title: string;
  description: string;
  date: string;
  sourceUrl: string;
}

export interface MentorReviewRequest {
  id: string;
  version: number;
  memberName: string;
  claimTitle: string;
  claimDescription: string;
  evidence: { id: string; title: string; url: string }[];
  confirmations?: ClaimConfirmation[];
  // Form availability, not a claim that this contribution has never been reviewed.
  status: "pending" | "confirmed" | "declined";
  /** This mentor set this revision aside ("I can't confirm this"); only they ever see it. */
  setAside?: boolean;
}

export interface MentorReviewDecision {
  decision: "confirmed" | "declined";
  note: string;
  method: string;
  expectedRevision: number;
}
