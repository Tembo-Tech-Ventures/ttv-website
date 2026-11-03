import type { CommunityJourney } from "@/lib/community/model";
import type { OpportunityGateState } from "@/components/hire/validation";
import type { StudentDashboardLinkId, StudentJourneyState } from "@/lib/student/journey";
import type { CommunityFraming } from "@/components/platform/onboarding/framing";
import { MENTORS_PATH } from "@/components/platform/mentors/mentor-display";
import { SPACE_PAGE_PATHS } from "@/components/platform/spaces/sidebar";

/*
 * What the Profile space's Overview says (T01, prototype screens/07), as data. Pure: the page
 * renders this, and the tests read it without a database. Everything here comes from records
 * that already exist (the public builder profile, the contributions shared on Your journey and
 * their mentor confirmations, visitor messages, writing drafts, client projects and
 * certificates), and every line describes something the platform does today.
 */

const PROFILE_EDITOR_PATH = SPACE_PAGE_PATHS.portfolio;
const JOURNEY_PATH = SPACE_PAGE_PATHS.journey;
const LEADS_PATH = SPACE_PAGE_PATHS.leads;
const WRITING_PATH = SPACE_PAGE_PATHS.writing;

/** A client project's card on the Opportunities page, as an id an URL fragment can carry. */
export function opportunityAnchor(projectId: string): string {
  return `project-${encodeURIComponent(projectId)}`;
}

/** How many rows each list shows before "See all". */
export const OVERVIEW_LIMITS = { projects: 5, leads: 3, drafts: 3, journeyNeeds: 3, opportunities: 3 } as const;

export type PublicProfileStatus = "DRAFT" | "PUBLISHED" | "SUSPENDED";

export interface OverviewFacts {
  /** The signed-in person, as their account names them. */
  person: { id: string; name: string; image: string | null };
  /** The existing journey's state and unlocked destinations (lib/student/journey). */
  journeyState: StudentJourneyState;
  visibleLinkIds: readonly StudentDashboardLinkId[];
  /** A completed cohort opens the public builder profile (owner decision 2026-10-06, rule 1). */
  eligible: boolean;
  profile: {
    status: PublicProfileStatus;
    handle: string;
    headline: string | null;
    bio: string | null;
    location: string | null;
    country: string | null;
    skills: readonly string[];
    publicName: string | null;
    publicAvatarUrl: string | null;
  } | null;
  /** The person's own contributions with their confirmations, newest first; null when they could not be read. */
  journey: readonly CommunityJourney[] | null;
  /** Visitor messages nobody has opened yet, newest first, and how many there are. */
  leads: { items: readonly { id: string; fromName: string; organization: string | null }[]; total: number };
  /** Writing drafts, most recently edited first. */
  drafts: readonly { id: string; title: string }[];
  /** Approved client projects, while the opportunities gate is open. */
  opportunities: { gate: OpportunityGateState; items: readonly { id: string; title: string; organization: string; interested: boolean }[] };
  /** Completed cohorts with a certificate, newest first. */
  certificates: readonly { id: string; programName: string }[];
  /** Whether "Ask for time" is open to this person (mentor requests). */
  mentorRequests: boolean;
  /** How onboarding frames this person, when it does: "partner" chose to mentor or find people, not to build and learn. */
  framing: CommunityFraming | null;
}

export interface OverviewCard {
  name: string;
  avatar: { id: string; src: string | null };
  /** "Backend builder", "Kisumu", "Cohort 02": only the parts that exist, shown joined by dots. */
  meta: readonly string[];
  bio: string | null;
  skills: readonly string[];
  status: { label: string; tone: "ring" | "peach" | "neutral" };
  publicHref: string | null;
}

/** The profile card when there is no public profile yet, saying what opens it. */
export interface OverviewNoProfile {
  kind: "create" | "locked" | "partner";
  title: string;
  body: string;
  action: { href: string; label: string } | null;
}

export type ProjectState =
  | { kind: "confirmed"; text: string; mentors: readonly string[] }
  | { kind: "newer"; text: string; mentors: readonly string[] }
  | { kind: "waiting"; text: string }
  | { kind: "draft"; text: string };

export interface OverviewProject {
  id: string;
  title: string;
  /** The first line of the description, trimmed for a row. */
  summary: string;
  revision: number;
  state: ProjectState;
}

export type NeedIcon = "message" | "revision" | "draft" | "profile";

export interface OverviewNeed {
  key: string;
  icon: NeedIcon;
  text: string;
  action: { href: string; label: string; name: string };
}

export interface OverviewOpportunity {
  id: string;
  title: string;
  organization: string;
  interested: boolean;
  /** The project's own card on the Opportunities page, where the hand is raised. */
  href: string;
}

export interface ProfileOverviewModel {
  title: string;
  lead: string;
  actions: { view: string | null; edit: { href: string; label: string } | null };
  card: OverviewCard | null;
  noProfile: OverviewNoProfile | null;
  projects: { items: readonly OverviewProject[]; total: number; available: boolean };
  needs: readonly OverviewNeed[];
  /** Null when the opportunities page is not open to this person, so nothing about it is shown. */
  opportunities: { items: readonly OverviewOpportunity[]; more: boolean } | null;
  certificates: readonly { id: string; programName: string; href: string }[];
}

const STATUS: Record<PublicProfileStatus, OverviewCard["status"]> = {
  PUBLISHED: { label: "Published", tone: "ring" },
  DRAFT: { label: "Draft", tone: "neutral" },
  SUSPENDED: { label: "Suspended", tone: "peach" },
};

/** The first line of a description, cut on a word boundary near `max` characters, with an ellipsis. */
export function summarise(text: string, max = 120): string {
  const line = text.trim().split(/\r?\n/, 1)[0]!.trim();
  if (line.length <= max) return line;
  const cut = line.slice(0, max);
  const space = cut.lastIndexOf(" ");
  return `${(space > max * 0.6 ? cut.slice(0, space) : cut).replace(/[\s,.;:–—-]+$/, "")}…`;
}

/** A row's summary reads as a phrase, as the prototype's do: no closing full stop. */
function phrase(text: string): string {
  return text.replace(/(?<!\.)\.$/, "");
}

/** "David", "David and Mercy", "David, Mercy and Wanjiru". */
export function joinNames(names: readonly string[]): string {
  if (names.length <= 1) return names[0] ?? "";
  return `${names.slice(0, -1).join(", ")} and ${names.at(-1)}`;
}

function distinct(values: readonly string[]): string[] {
  return [...new Set(values)];
}

/**
 * Where a contribution stands. A confirmation covers the revision a mentor checked; an edit makes a
 * new revision, which waits for a mentor again (src/lib/mentoring/README.md). A private
 * contribution is an unpublished draft that only its author sees.
 */
export function projectState(entry: CommunityJourney): ProjectState {
  if (entry.visibility === "private") return { kind: "draft", text: "Draft, only you can see it" };
  const current = distinct(entry.confirmations.filter((c) => c.journeyVersion === entry.version).map((c) => c.mentorName));
  if (current.length > 0) return { kind: "confirmed", text: `Confirmed by ${joinNames(current)}`, mentors: current };
  const earlier = entry.confirmations.filter((c) => c.journeyVersion < entry.version);
  if (earlier.length > 0) {
    const latest = Math.max(...earlier.map((c) => c.journeyVersion));
    const mentors = distinct(earlier.filter((c) => c.journeyVersion === latest).map((c) => c.mentorName));
    return { kind: "newer", text: `${joinNames(mentors)} confirmed revision ${latest}`, mentors };
  }
  return { kind: "waiting", text: "Not confirmed yet" };
}

function card(facts: OverviewFacts): OverviewCard | null {
  const { profile, person } = facts;
  // A profile that exists is shown as it is, even if the completion behind it has since changed.
  if (!profile) return null;
  const cohort = facts.certificates[0]?.programName ?? null;
  const place = profile.location?.trim() || profile.country?.trim() || null;
  return {
    name: profile.publicName?.trim() || person.name,
    avatar: { id: person.id, src: profile.publicAvatarUrl ?? person.image },
    meta: [profile.headline?.trim() || null, place, cohort].filter((part): part is string => Boolean(part)),
    bio: profile.bio?.trim() || null,
    skills: profile.skills,
    status: STATUS[profile.status],
    publicHref: profile.status === "PUBLISHED" ? `/talent/${encodeURIComponent(profile.handle)}` : null,
  };
}

function noProfile(facts: OverviewFacts): OverviewNoProfile | null {
  if (facts.profile) return null;
  if (facts.eligible) {
    return {
      kind: "create",
      title: "Your public builder page is ready to set up",
      body: "You've completed a cohort, so you can publish a page with your work, skills and how to reach you. It stays a draft until you publish it.",
      action: { href: PROFILE_EDITOR_PATH, label: "Create your profile" },
    };
  }
  // Someone who chose to mentor or find people is not sent to apply (QAO-07); PartnerProfileNote says the rest.
  if (facts.framing === "partner") return { kind: "partner", title: "", body: "", action: null };
  const applying = facts.journeyState === "no_application" || facts.journeyState === "rejected";
  return {
    kind: "locked",
    title: "Your public builder page opens when you complete a cohort",
    body: applying
      ? "Cohort graduates get a page with their work and skills. Until then, the work you share on Your journey is how mentors and approved organisations get to know you."
      : "When your cohort is complete, you can publish a page with your work and skills. Until then, the work you share on Your journey is how mentors and approved organisations get to know you.",
    action: applying ? { href: SPACE_PAGE_PATHS.apply, label: "Apply to a cohort" } : null,
  };
}

/** One row for the journey rows past the cap, so a long journey never pushes the rest of the page away. */
function moreOnJourney(key: string, total: number, one: string, many: string): OverviewNeed[] {
  const more = total - OVERVIEW_LIMITS.journeyNeeds;
  if (more <= 0) return [];
  return [{
    key: `journey-more-${key}`, icon: key === "drafts" ? "draft" : "revision", text: `${more} more ${more === 1 ? one : many} on Your journey`,
    action: { href: JOURNEY_PATH, label: "See all", name: `See all ${many} on Your journey` },
  }];
}

function needs(facts: OverviewFacts, projects: readonly OverviewProject[]): OverviewNeed[] {
  const visible = new Set(facts.visibleLinkIds);
  const list: OverviewNeed[] = [];
  if (visible.has("leads")) {
    for (const lead of facts.leads.items.slice(0, OVERVIEW_LIMITS.leads)) {
      const who = lead.organization ? `${lead.fromName} from ${lead.organization}` : lead.fromName;
      list.push({
        key: `lead-${lead.id}`, icon: "message", text: `${who} wrote to you`,
        action: { href: LEADS_PATH, label: "Read", name: `Read the message from ${who}` },
      });
    }
    const more = facts.leads.total - Math.min(facts.leads.items.length, OVERVIEW_LIMITS.leads);
    if (more > 0) {
      list.push({
        key: "leads-more", icon: "message", text: `${more} more ${more === 1 ? "message" : "messages"} from visitors`,
        action: { href: LEADS_PATH, label: "See all", name: "See all visitor messages" },
      });
    }
  }
  const newer = projects.filter((project) => project.state.kind === "newer");
  for (const project of newer.slice(0, OVERVIEW_LIMITS.journeyNeeds)) {
    list.push({
      key: `revision-${project.id}`, icon: "revision", text: `${project.title}: revision ${project.revision} isn't confirmed yet`,
      action: facts.mentorRequests
        ? { href: MENTORS_PATH, label: "Ask a mentor", name: `Ask a mentor about ${project.title}` }
        : { href: JOURNEY_PATH, label: "Open", name: `Open ${project.title} on Your journey` },
    });
  }
  list.push(...moreOnJourney("revisions", newer.length, "newer revision", "newer revisions"));
  if (facts.profile?.status === "DRAFT") {
    list.push({
      key: "profile-draft", icon: "profile", text: "Your public profile is a draft",
      action: { href: PROFILE_EDITOR_PATH, label: "Publish", name: "Publish your public profile" },
    });
  }
  const drafts = projects.filter((project) => project.state.kind === "draft");
  for (const project of drafts.slice(0, OVERVIEW_LIMITS.journeyNeeds)) {
    list.push({
      key: `journey-draft-${project.id}`, icon: "draft", text: `Draft: “${project.title}”`,
      action: { href: JOURNEY_PATH, label: "Finish", name: `Finish ${project.title} on Your journey` },
    });
  }
  list.push(...moreOnJourney("drafts", drafts.length, "draft", "drafts"));
  if (visible.has("writing")) {
    for (const draft of facts.drafts.slice(0, OVERVIEW_LIMITS.drafts)) {
      list.push({
        key: `writing-draft-${draft.id}`, icon: "draft", text: `Draft: “${draft.title}”`,
        action: { href: `${WRITING_PATH}/${encodeURIComponent(draft.id)}`, label: "Finish", name: `Finish your draft ${draft.title}` },
      });
    }
  }
  return list;
}

export function profileOverview(facts: OverviewFacts): ProfileOverviewModel {
  const all = (facts.journey ?? []).map((entry): OverviewProject => ({
    id: entry.id, title: entry.title, summary: phrase(summarise(entry.description)), revision: entry.version, state: projectState(entry),
  }));
  const shown = card(facts);
  const visible = new Set(facts.visibleLinkIds);
  const opportunitiesOpen = visible.has("opportunities") && facts.opportunities.gate === "published";
  return {
    title: "Your profile",
    lead: shown
      ? "What visitors and approved organisations see, and what's waiting for you."
      : "Your work, what's waiting for you, and what opens next.",
    actions: {
      view: shown?.publicHref ?? null,
      edit: facts.profile ? { href: PROFILE_EDITOR_PATH, label: "Edit" } : null,
    },
    card: shown,
    noProfile: noProfile(facts),
    projects: { items: all.slice(0, OVERVIEW_LIMITS.projects), total: all.length, available: facts.journey !== null },
    needs: needs(facts, all),
    opportunities: opportunitiesOpen
      ? {
        items: facts.opportunities.items.slice(0, OVERVIEW_LIMITS.opportunities).map((item) => ({
          ...item, href: `${SPACE_PAGE_PATHS.opportunities}#${opportunityAnchor(item.id)}`,
        })),
        more: facts.opportunities.items.length > OVERVIEW_LIMITS.opportunities,
      }
      : null,
    certificates: facts.certificates.map((certificate) => ({ ...certificate, href: `/certificate/${encodeURIComponent(certificate.id)}` })),
  };
}
