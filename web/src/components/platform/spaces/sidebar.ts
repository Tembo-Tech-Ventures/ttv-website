import type { AccessRole, Channel, Me, SpaceId } from "@/lib/platform/contracts";
import { CONDUCT_PATH, SPACE_PATHS, type ChannelSpace } from "@/lib/platform/server/space-routes";
import type { StudentDashboardLinkId } from "@/lib/student/journey";
import { ACCOUNT_PATH, requestRowId } from "@/components/platform/onboarding/account-actions";
import { PARTNER, REQUEST, TAKING_PART } from "@/components/platform/onboarding/copy";
import { offersCohort, type OnboardingView } from "@/components/platform/onboarding/framing";
import { CONDUCT_TITLE } from "@/components/channels/conduct";
import { channelPath, channelPathPrefix } from "@/components/channels/paths";

/**
 * What each space's sidebar lists, as data. The links are the existing pages
 * at their canonical space paths (B-1.2); nothing here opens a page that does
 * not exist yet, and nothing here grants access: every page and API still
 * authorises its own request.
 */

/** The existing page a person is on, so its sidebar entry is marked current. */
export type SpacePageKey =
  | "cohort"
  | "apply"
  | "sessions"
  | "ask"
  | "journey"
  | "mentoring"
  | "confirm"
  | "discover"
  | "portfolio"
  | "writing"
  | "opportunities"
  | "leads"
  | "account"
  | "feedback"
  | "communityChannel"
  | "cohortChannel"
  | "conduct";

export type SidebarIcon =
  | "overview"
  | "apply"
  | "sessions"
  | "tembo"
  | "journey"
  | "people"
  | "mentors"
  | "requests"
  | "confirm"
  | "availability"
  | "discover"
  | "profile"
  | "writing"
  | "opportunities"
  | "messages"
  | "certificate"
  | "account"
  | "feedback"
  | "admin"
  | "mentorRequest"
  | "institutionRequest"
  | "channel"
  | "cohortChannel"
  | "conduct";

export interface SidebarItem {
  key: string;
  href: string;
  label: string;
  icon: SidebarIcon;
  current: boolean;
  /** Unread attention, shown as a count badge. */
  count?: number;
  /** What the badge counts, when it is not unread attention ("new"). */
  countLabel?: string;
  /** Quiet text, for an entry whose page is not open yet. */
  note?: string;
  /** Shows the note as a status chip in this tone, such as a request's "Pending". */
  noteTone?: "ring";
  /** Leaves the app for a public page of the website, and says so. */
  publicPage?: boolean;
  /** A channel: its name is bold while it has unread messages, and quieter once read. */
  emphasis?: "read" | "unread";
}

export interface SidebarGroupModel {
  label?: string;
  items: SidebarItem[];
}

export interface SidebarModel {
  title: string;
  description: string;
  groups: SidebarGroupModel[];
}

export interface SidebarFacts {
  me: Me;
  /** The page being rendered. */
  page: SpacePageKey;
  /** The existing journey's unlocked destinations, so the spaces show what the old sidebar showed. */
  visibleLinkIds: readonly StudentDashboardLinkId[];
  unreadLeadCount: number;
  /** Completed cohorts with a certificate, newest first. */
  certificates: readonly { id: string; programName: string }[];
  /** Restricted synthetic identities may only follow their allowlisted paths. */
  allowed?: (href: string) => boolean;
  /** How onboarding frames Community, when it is on for this person (space-page.ts). */
  onboarding?: Pick<OnboardingView, "framing" | "pending"> | null;
  /** The channels this person can read, while `channels` is on for them. Without it the sidebars are as they were. */
  channels?: SidebarChannels | null;
}

export interface SidebarChannels {
  /** Readable channels, in the server's order. Each space lists its own kind; direct conversations wait for Phase 4. */
  items: readonly Channel[];
  /** The channel being read, marked current. */
  currentId?: string | null;
}

/** Where each page opens, in order of preference. The first space the person can open wins. */
export const PAGE_SPACES: Readonly<Record<SpacePageKey, readonly SpaceId[]>> = {
  cohort: ["cohort"],
  // Applying and Ask Tembo stay open to every signed-in person (B-1.2). Without
  // a cohort yet, they open in Community, where the way to apply lives.
  apply: ["cohort", "community"],
  ask: ["cohort", "community"],
  sessions: ["cohort"],
  journey: ["community"],
  // Admins keep the existing mentor review page without becoming mentors.
  mentoring: ["mentoring"],
  confirm: ["mentoring", "admin"],
  discover: ["discover"],
  portfolio: ["profile"],
  writing: ["profile"],
  opportunities: ["profile"],
  leads: ["profile"],
  account: ["profile"],
  feedback: ["profile"],
  communityChannel: ["community"],
  cohortChannel: ["cohort"],
  conduct: ["community"],
};

export const SPACE_PAGE_PATHS = {
  cohort: SPACE_PATHS.cohort,
  apply: "/dashboard/cohort/apply",
  sessions: "/dashboard/cohort/sessions",
  ask: "/dashboard/cohort/ask",
  journey: SPACE_PATHS.community,
  mentoring: SPACE_PATHS.mentoring,
  confirm: "/dashboard/mentoring/confirm",
  discover: SPACE_PATHS.discover,
  portfolio: SPACE_PATHS.profile,
  writing: "/dashboard/me/writing",
  opportunities: "/dashboard/me/opportunities",
  leads: "/dashboard/me/leads",
  account: "/dashboard/account",
  feedback: "/dashboard/feedback",
  // A channel page is one of many under this prefix; its own path is channelPath(channel).
  communityChannel: channelPathPrefix("community"),
  cohortChannel: channelPathPrefix("cohort"),
  conduct: CONDUCT_PATH,
} as const satisfies Record<SpacePageKey, string>;

/** What an entry whose page has not opened says, here and on the page it leads to. */
export const NOT_OPEN_YET = "Not open yet";

/** An entry opens either one of the migrated pages (and is current on it) or a plain path, current only when it says so. */
type Entry = Omit<SidebarItem, "current" | "href"> & (
  | { page: SpacePageKey; href?: never; current?: never }
  | { href: string; page?: never; current?: boolean }
);

function item(facts: SidebarFacts, entry: Entry): SidebarItem {
  const { page, href, current = false, ...rest } = entry;
  return page === undefined ? { ...rest, href, current } : { ...rest, href: SPACE_PAGE_PATHS[page], current: page === facts.page };
}

function group(facts: SidebarFacts, label: string | undefined, entries: (Entry | false)[]): SidebarGroupModel[] {
  const allowed = facts.allowed ?? (() => true);
  const items = entries.filter((entry): entry is Entry => entry !== false).map((entry) => item(facts, entry)).filter((entry) => allowed(entry.href));
  return items.length > 0 ? [{ ...(label ? { label } : {}), items }] : [];
}

const CHANNEL_KIND = { community: "COMMUNITY", cohort: "COHORT" } as const satisfies Record<ChannelSpace, Channel["kind"]>;

/**
 * A space's channels. Nothing while `channels` is off for the person, and
 * nothing in a space with no channel they can read (an applicant's Cohort).
 * Community, where the page lives, ends the list with the way back to how we
 * talk to each other; Cohort does not, so no sidebar link changes space.
 * Every channel shows the habits itself on a person's first visit.
 */
function channels(facts: SidebarFacts, space: ChannelSpace): SidebarGroupModel[] {
  const readable = facts.channels?.items.filter((channel) => channel.kind === CHANNEL_KIND[space]) ?? [];
  if (readable.length === 0) return [];
  return group(facts, "Channels", [
    ...readable.map((channel): Entry => {
      const unread = channel.unreadCount;
      return {
        key: `channel-${channel.id}`,
        href: channelPath(channel)!,
        label: channel.name,
        icon: space === "cohort" ? "cohortChannel" : "channel",
        current: channel.id === facts.channels?.currentId,
        emphasis: unread > 0 ? "unread" : "read",
        ...(unread > 0 ? { count: unread, countLabel: unread === 1 ? "unread message" : "unread messages" } : {}),
        ...(channel.archivedAt !== null ? { note: "Archived" } : {}),
      };
    }),
    // Set in the channels' quieter weight: a way back to the habits, not one more place to read.
    space === "community" && { key: "conduct", page: "conduct", label: CONDUCT_TITLE, icon: "conduct", emphasis: "read" },
  ]);
}

function cohort(facts: SidebarFacts): SidebarModel {
  const visible = new Set(facts.visibleLinkIds);
  return {
    title: "Cohort",
    description: "Your application, the sessions and Ask Tembo.",
    groups: [
      ...group(facts, undefined, [
        { key: "cohort", page: "cohort", label: "Overview", icon: "overview" },
        visible.has("sessions") && { key: "sessions", page: "sessions", label: "Sessions", icon: "sessions" },
        { key: "ask", page: "ask", label: "Ask Tembo", icon: "tembo" },
        { key: "apply", page: "apply", label: "Apply", icon: "apply" },
      ]),
      ...channels(facts, "cohort"),
    ],
  };
}

const REQUEST_ICONS = { MENTOR: "mentorRequest", INSTITUTION: "institutionRequest" } as const satisfies Record<AccessRole, SidebarIcon>;

function community(facts: SidebarFacts): SidebarModel {
  // Without a cohort, Community is where a member lands, so it carries the way in.
  const noCohort = !facts.me.spaces.includes("cohort");
  const framing = facts.onboarding?.framing;
  // Mentors and organisations who did not choose to build and learn are not offered a cohort (onboarding SPEC §3).
  const apply = noCohort && offersCohort(framing);
  return {
    title: "Community",
    description: "Builders, alumni and mentors across every cohort.",
    groups: [
      ...group(facts, undefined, [
        { key: "journey", page: "journey", label: framing === "partner" ? PARTNER.ownWork : "Your journey", icon: "journey" },
        noCohort && { key: "ask", page: "ask", label: "Ask Tembo", icon: "tembo" },
      ]),
      ...channels(facts, "community"),
      // The directories are the website's public pages, outside the app: say so before the click.
      ...group(facts, "Public directory", [
        { key: "members", href: "/community/members", label: "Members", icon: "people", publicPage: true },
        { key: "mentors", href: "/community/mentors", label: "Mentors", icon: "mentors", publicPage: true },
      ]),
      ...(apply ? group(facts, "Cohorts", [{ key: "apply", page: "apply", label: "Apply to a cohort", icon: "apply" }]) : []),
      // Requests are not tabs: only granted roles get a space. Each opens Account, where it can be withdrawn.
      ...group(facts, "Your requests", (facts.onboarding?.pending ?? []).map((role) => ({
        key: `request-${role.toLowerCase()}`,
        href: `${ACCOUNT_PATH}#${requestRowId(role)}`,
        label: REQUEST.sections[role],
        icon: REQUEST_ICONS[role],
        note: TAKING_PART.chips.pending,
        noteTone: "ring" as const,
      }))),
    ],
  };
}

function mentoring(facts: SidebarFacts): SidebarModel {
  const awaiting = facts.me.mentoring?.awaitingConfirmation ?? 0;
  return {
    title: "Mentoring",
    description: "Confirm the work people share with you.",
    groups: group(facts, undefined, [
      { key: "mentoring", page: "mentoring", label: "Overview", icon: "overview" },
      {
        key: "confirm", page: "confirm", label: "Confirm work", icon: "confirm",
        // Derived from the Confirm page's own rows, not attention (src/lib/mentoring/README.md).
        ...(awaiting > 0 ? { count: awaiting, countLabel: "waiting for your confirmation" } : {}),
      },
      // Requests and availability arrive with mentor requests; the overview says so, in the same words.
      { key: "requests", href: `${SPACE_PATHS.mentoring}#requests`, label: "Requests", icon: "requests", note: NOT_OPEN_YET },
      { key: "availability", href: `${SPACE_PATHS.mentoring}#availability`, label: "Availability", icon: "availability", note: NOT_OPEN_YET },
    ]),
  };
}

function discover(facts: SidebarFacts): SidebarModel {
  return {
    title: "Discover",
    description: "Find builders whose documented work fits what you need.",
    groups: group(facts, undefined, [{ key: "discover", page: "discover", label: "Discover people", icon: "discover" }]),
  };
}

function admin(facts: SidebarFacts): SidebarModel {
  return {
    title: "Admin",
    description: "Programmes, people and reviews.",
    groups: group(facts, undefined, [
      { key: "admin", href: SPACE_PATHS.admin, label: "Admin home", icon: "admin" },
      { key: "confirm", page: "confirm", label: "Mentor review", icon: "confirm" },
    ]),
  };
}

function certificates(facts: SidebarFacts): SidebarGroupModel[] {
  return group(facts, "Certificates", facts.certificates.map((certificate) => ({
    key: `certificate-${certificate.id}`,
    href: `/certificate/${encodeURIComponent(certificate.id)}`,
    label: certificate.programName,
    icon: "certificate" as const,
  })));
}

function profile(facts: SidebarFacts): SidebarModel {
  const visible = new Set(facts.visibleLinkIds);
  return {
    title: "Profile",
    description: "Your public story and what it brings in.",
    groups: [
      ...group(facts, undefined, [
        { key: "portfolio", page: "portfolio", label: "Public profile", icon: "profile" },
        visible.has("writing") && { key: "writing", page: "writing", label: "Writing", icon: "writing" },
        visible.has("opportunities") && { key: "opportunities", page: "opportunities", label: "Opportunities", icon: "opportunities" },
        visible.has("leads") && {
          key: "leads", page: "leads", label: "Visitor messages", icon: "messages",
          ...(facts.unreadLeadCount > 0 ? { count: facts.unreadLeadCount } : {}),
        },
      ]),
      ...certificates(facts),
      ...group(facts, "Settings", [
        { key: "account", page: "account", label: "Account", icon: "account" },
        { key: "feedback", page: "feedback", label: "Your feedback", icon: "feedback" },
      ]),
    ],
  };
}

const BUILDERS: Record<SpaceId, (facts: SidebarFacts) => SidebarModel> = {
  cohort, community, mentoring, discover, admin, profile,
};

export function spaceSidebar(space: SpaceId, facts: SidebarFacts): SidebarModel {
  return BUILDERS[space](facts);
}
