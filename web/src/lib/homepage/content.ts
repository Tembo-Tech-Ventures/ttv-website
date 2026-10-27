import { VALUES } from "@/components/homepage/values";
import { communityEntryHref } from "@/lib/community-entry";
import { SITE_FACTS } from "@/lib/site";

/**
 * Everything the homepage says, in the order it says it.
 *
 * Every statement here must stay true of the product today: no placements,
 * outcomes or features that do not exist. Keep copy in community voice, not
 * rescue voice.
 */

export const COHORT = {
  title: "Cohorts where builders learn by shipping real software.",
  summary:
    "An African tech community, starting in East Africa and Nigeria. Small groups work side by side for a few months, with working engineers in the room. The work, and the people you build it with, are what stay.",
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
  /** Who can apply, short enough to sit beside the apply button. */
  eligibility: "No degree required.",
  secondary: { label: "Meet the builders", href: "#builders" },
  /** Cohorts 01 to the current one; only the current cohort is running. */
  timeline: Array.from({ length: Number(SITE_FACTS.currentCohortNumber) }, (_, index) => {
    const number = String(index + 1).padStart(2, "0");
    const running = number === SITE_FACTS.currentCohortNumber;
    return { number, label: `Cohort ${number}`, status: running ? "Running now" : "Complete", running };
  }),
} as const;

/**
 * The skills-map picture. An illustration of how skills connect,
 * drawn from skills on published profiles. TTV does not yet track anyone's
 * progress through a map, so nothing here may say or imply that it does.
 */
export const SKILLS_MAP = {
  title: "Every skill opens onto the next.",
  summary:
    "A cohort is a path through a map of skills, walked with other builders and the engineers alongside them. The map keeps going after the cohort ends.",
  caption: "An illustration, drawn from the skills on our builders' published profiles.",
  /** Shown when no profiles are published, so the caption never claims data it lacks. */
  emptyCaption: "An illustration of how skills connect.",
} as const;

export const BUILDERS = {
  title: "Meet the builders.",
  summary: "Cohort graduates who chose to publish their profile, and the work they put their names to.",
  all: { label: "See every builder", href: "/talent" },
  empty: "Graduates publish their profiles when they finish a cohort. The first ones will appear here.",
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
  joinLabel: "Join the community",
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

/** The homepage's sections, top to bottom, as the owner set them. */
export const SECTION_ORDER = ["cohorts", "builders", "community", "hire", "principles"] as const;
