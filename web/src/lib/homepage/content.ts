import { VALUES } from "@/components/homepage/values";
import { communityEntryHref } from "@/lib/community-entry";
import { SITE_FACTS } from "@/lib/site";

/**
 * Everything the homepage says, in the order it says it.
 *
 * The three homepage design candidates share this module so they differ only
 * in composition and motion, never in claims. Every statement here must stay
 * true of the product today: no placements, outcomes or features that do not
 * exist. Keep copy in community voice, not rescue voice.
 */

export const COHORT = {
  title: "Cohorts where builders learn by shipping real software.",
  summary:
    "Small groups work side by side for a few months, with working engineers in the room. The curriculum is scaffolding. The work, and the people you build it with, are what stay.",
  facts: [
    { value: SITE_FACTS.approximateStudentCount, label: "builders through our cohorts" },
    { value: SITE_FACTS.currentCohortNumber, label: "cohorts, one running now" },
    { value: SITE_FACTS.partnerSchoolCount, label: `partner school, ${SITE_FACTS.partnerSchoolName}` },
  ],
  rhythm: [
    { title: "Build together", copy: "A small group, real projects, weekly sessions. Accountability over assignments." },
    { title: "Engineers alongside", copy: "Working engineers share how a real system fits together, then help you build one." },
    { title: "Stay in touch", copy: "The cohort ends. The community does not. Some alumni come back as mentors." },
  ],
  apply: { label: "Apply for a cohort", href: "/dashboard/apply" },
} as const;

export const BUILDERS = {
  title: "Meet the builders.",
  summary: "Cohort graduates who chose to publish their profile, and the work they put their names to.",
  all: { label: "See every builder", href: "/talent" },
} as const;

export interface CommunityPath {
  id: "builder" | "mentor" | "partner";
  role: string;
  promise: string;
  detail: string;
  href: string;
  cta: string;
}

export const COMMUNITY = {
  title: "Not in a cohort? Join the community.",
  summary:
    "The community is open beyond our cohorts. Show your work, help someone else's make sense, or meet the people doing it.",
  paths: [
    {
      id: "builder",
      role: "Builder",
      promise: "Show the work you've done and the part you played in it.",
      detail: "Open to anyone, with or without a cohort.",
      href: "/community/members",
      cta: "Join as a builder",
    },
    {
      id: "mentor",
      role: "Mentor",
      promise: "Review specific work and add context someone can stand behind.",
      detail: "Mentor access is approved by the TTV team.",
      href: "/community/mentors",
      cta: "Join as a mentor",
    },
    {
      id: "partner",
      role: "Institutional partner",
      promise: "Explore community members and the documented work behind each profile.",
      detail: "Institutional access is approved by the TTV team.",
      href: "/community/institutions",
      cta: "Partner with us",
    },
  ] satisfies readonly CommunityPath[],
  join: (isAuthenticated: boolean) => communityEntryHref(isAuthenticated),
} as const;

export const HIRE = {
  title: "Hire our builders.",
  summary:
    "Have a project, a role or a piece of work to propose? Tell us about it and we will introduce you to builders who fit. Scoping and contracts happen directly between you and them.",
  primary: { label: "Propose a project", href: "/hire" },
  secondary: { label: "Browse builders", href: "/talent" },
} as const;

export const PRINCIPLES = {
  title: "What we hold ourselves to.",
  values: VALUES,
} as const;

/** The homepage's sections, top to bottom. Candidates must keep this order. */
export const SECTION_ORDER = ["cohort", "builders", "community", "hire", "principles"] as const;
