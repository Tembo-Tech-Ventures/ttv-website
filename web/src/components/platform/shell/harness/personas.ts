import type { Me, SpaceId } from "@/lib/platform/contracts";
import { meByPersona } from "@/lib/platform/fixtures";

/**
 * Harness only: the shared synthetic personas, plus three shapes the fixtures
 * do not have. "every" opens all six spaces with something waiting in each, the
 * widest the tab row and bottom bar can get. "unbadged" has no role badges,
 * which is valid for a program-only person, so the shell must show no chips.
 * "confirming" is David with nothing unread but shared work waiting for his
 * confirmation, which the bell shows as a dot.
 */
const every: Me = {
  ...meByPersona.amina,
  spaces: ["cohort", "community", "mentoring", "discover", "admin", "profile"],
  unreadCounts: { cohort: 2, community: 5, mentoring: 2, discover: 1, admin: 3, profile: 12 },
};

const unbadged: Me = {
  ...meByPersona.brian,
  user: { ...meByPersona.brian.user, roleBadges: [] },
};

const confirming: Me = {
  ...meByPersona.david,
  unreadCounts: { cohort: 0, community: 0, mentoring: 0, discover: 0, admin: 0, profile: 0 },
  mentoring: { awaitingConfirmation: 4 },
};

export const HARNESS_PERSONAS = { ...meByPersona, every, unbadged, confirming } as const;
export type HarnessPersona = keyof typeof HARNESS_PERSONAS;

export function isHarnessPersona(value: string | null): value is HarnessPersona {
  return value !== null && Object.hasOwn(HARNESS_PERSONAS, value);
}

export function harnessHref(persona: HarnessPersona, space: SpaceId, extra = ""): string {
  return `/dev/platform-shell?persona=${persona}&space=${space}${extra}`;
}
