import type { DiscoveryCaller } from "@/lib/community/eligibility";

/** All dates crossing this read contract are Unix seconds, except occurredAt (YYYY-MM-DD). */
export interface WorkView {
  id: string;
  title: string;
  description: string;
  link: string | null;
  kind: "contribution" | "repo";
  repo: {
    fullName: string;
    description: string | null;
    language: string | null;
    topics: string[];
    stars: number;
    pushedAt: number | null;
    snapshotAt: number;
  } | null;
  occurredAt: string;
  revision: number;
  confirmations: Array<{
    id: string;
    mentorName: string;
    statement: string;
    method: string;
    revision: number;
    isCurrentRevision: boolean;
    createdAt: number;
  }>;
}

export interface MemberCard {
  handle: string;
  displayName: string;
  avatarUrl: string | null;
  headline: string;
  skills: string[];
  opportunityGoals: string;
  openToFreelance: boolean;
  openToRoles: boolean;
  postedWorkCount: number;
  confirmedWorkCount: number;
  completedCohorts: string[];
  onPublicSite: boolean;
}

export interface MemberProfileView extends MemberCard {
  bio: string;
  work: WorkView[];
  publicUrl: string | null;
  isOwn: boolean;
}

export interface MemberFilters {
  q?: string;
  skills?: string[];
  openTo?: "freelance" | "roles";
  cursor?: string;
}

export interface MemberPage {
  members: MemberCard[];
  nextCursor: string | null;
  total: number;
}

/** Contract-first stub for the UI lane. Replaced before PR B merges. */
export function listMembers(
  _db: D1Database,
  _caller: DiscoveryCaller,
  _filters: MemberFilters = {},
): Promise<MemberPage> {
  return Promise.reject(new Error("Member directory implementation pending"));
}

/** Null means unknown or inaccessible; callers must render the same 404. */
export function readMember(
  _db: D1Database,
  _caller: DiscoveryCaller,
  _handle: string,
): Promise<MemberProfileView | null> {
  return Promise.reject(new Error("Member directory implementation pending"));
}

/** The caller’s own card in the shared view, for the separate You card. */
export function readOwnMemberCard(_db: D1Database, _caller: DiscoveryCaller): Promise<MemberCard | null> {
  return Promise.reject(new Error("Member directory implementation pending"));
}
