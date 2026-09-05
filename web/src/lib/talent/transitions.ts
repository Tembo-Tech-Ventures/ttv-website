export type TransitionMap = Record<string, readonly string[]>;

export const PROFILE_TRANSITIONS: TransitionMap = {
  DRAFT: ["IN_REVIEW"],
  IN_REVIEW: ["PUBLISHED", "DRAFT"],
  PUBLISHED: ["SUSPENDED"],
  SUSPENDED: ["PUBLISHED"],
};

export const POST_TRANSITIONS: TransitionMap = {
  DRAFT: ["PUBLISHED"],
  PUBLISHED: ["DRAFT", "SUSPENDED"],
  SUSPENDED: ["DRAFT"],
};

export const PROJECT_TRANSITIONS: TransitionMap = {
  PENDING: ["APPROVED", "REJECTED"],
  APPROVED: ["CLOSED", "MATCHED"],
  REJECTED: [],
  CLOSED: [],
  MATCHED: ["CLOSED"],
};

export function canTransition(
  map: TransitionMap,
  from: string,
  to: string
): boolean {
  return (map[from] ?? []).includes(to);
}
