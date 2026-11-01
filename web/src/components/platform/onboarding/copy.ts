import type { AccessRole } from "@/lib/platform/contracts";
import type { PersonKind } from "@/components/platform/ui";

/**
 * The welcome and request steps' words: onboarding SPEC §2, verbatim, with the
 * prototype's typographic apostrophes. Change them only with the coordinator:
 * every sentence here describes something that ships, and nothing more.
 */

/** The intents a person can choose on a card. EXPLORING is the separate "just looking around" action. */
export type ChoiceIntent = "MEMBER" | "MENTOR" | "INSTITUTION";

export interface Choice {
  intent: ChoiceIntent;
  /** The network marker the homepage gave each kind of person. */
  marker: Exclude<PersonKind, "tembo">;
  title: string;
  body: string;
  /** Whether choosing this asks the team for access. It never grants it. */
  needsApproval: boolean;
}

export const CHOICES: readonly Choice[] = [
  {
    intent: "MEMBER",
    marker: "builder",
    title: "Build and learn",
    body: "Keep a community profile, add the work you’ve done, and apply to a cohort when one is open.",
    needsApproval: false,
  },
  {
    intent: "MENTOR",
    marker: "mentor",
    title: "Mentor",
    body: "Review work that members share, and record what you checked so their contribution is easier for others to understand.",
    needsApproval: true,
  },
  {
    intent: "INSTITUTION",
    marker: "institution",
    title: "Find people for your organisation",
    body: "Search saved community profiles and explore the work and evidence behind them.",
    needsApproval: true,
  },
];

export const WELCOME = {
  title: "How will you take part?",
  lead: "TTV is a community of builders, mentors and organisations around real work. Choose what fits. You can pick more than one and change it any time in Account.",
  open: "Open to everyone",
  needsApproval: "Needs team approval",
  /** Revisiting: the card says where the person already stands, from the request and the role. */
  pending: "Pending",
  active: "Active",
  info: "Mentor and organisation access opens when a TTV administrator approves your request. Until then you can use Community and your Profile like any member.",
  continue: "Continue",
  explore: "I’m just looking around",
  later: "You can choose later in Account.",
  required: "Choose at least one, or pick ‘I’m just looking around’.",
} as const;

export const REQUEST = {
  title: "A few details for the team",
  lead: "An administrator reads each request. While you wait, you can use Community and your Profile like any member.",
  back: "Back to your choices",
  sections: { MENTOR: "Mentor access", INSTITUTION: "Organisation access" } satisfies Record<AccessRole, string>,
  mentorNote: "What kind of work could you review?",
  mentorLink: "A link that shows your work",
  organisation: "Organisation name",
  organisationRole: "Your role there",
  institutionNote: "What would you like to explore?",
  institutionNoteHint: "A sentence or two is enough. For example, the kind of work you hope to find.",
  institutionLink: "Organisation website",
  optional: "(optional)",
  noteLength: "Between 20 and 600 characters.",
  scope: "I understand approval lets me explore saved community profiles and shared contributions only, and doesn’t arrange introductions.",
  scopeTitle: "What approval opens",
  /** The approved partner-page wording, consistent with F-4: saved profiles and shared work only. */
  opens: [
    "Discover: search saved community profiles.",
    "The contributions members share with institutions, with their sources and any mentor confirmations.",
  ],
  excludes: [
    "Not private cohort recordings, transcripts or internal records.",
    "Not introductions or interviews. Those stay your own next step.",
  ],
  privacy: "Only TTV administrators read this.",
  send: "Send request",
  sendBoth: "Send requests",
  errorTitle: "Check the highlighted answers",
} as const;

/** What went wrong, field by field. Each names the fix, not the rule. */
export const FIELD_ERRORS = {
  mentorNote: "Write at least 20 characters about the work you could review.",
  institutionNote: "Write at least 20 characters about what you’d like to explore.",
  tooLong: (max: number) => `Keep this to ${max} characters or fewer.`,
  organisation: "Enter your organisation’s name.",
  link: "Enter a web address, like https://example.org.",
  linkCredentials: "Enter the address without a username or password.",
  scope: "Confirm what approval opens before sending.",
} as const;

/** Why a step could not be saved, when the person's answers were fine. */
export const FAILURES = {
  // The limit is a rolling day, so no promise of when: "later" is what is true.
  rateLimited: "You’ve sent several requests in the last day. Your answers are still here: try again later.",
  unavailable: "That didn’t save. Your answers are still here: try again in a moment.",
} as const;

/**
 * The status cards at the top of a landing page (S3): SPEC §2 verbatim. They
 * are driven by the request and the role, never by the intent alone, and make
 * no promise about timing. The administrator who decided is never named.
 */
export const STATUS = {
  pending: {
    MENTOR: {
      title: "Your mentor request is with the team",
      body: "An administrator reads each request. The decision will appear here.",
      opens: "Mentoring opens as a new space once approved",
    },
    INSTITUTION: {
      title: "Your organisation request is with the team",
      body: "An administrator reads each request. The decision will appear here.",
      opens: "Discover opens as a new space once approved",
    },
  } satisfies Record<AccessRole, { title: string; body: string; opens: string }>,
  /** The institution version adds where to read about Discover meanwhile. */
  institutionsPage: { before: "Meanwhile, the public ", link: "For institutions", after: " page explains what Discover does." },
  sent: (date: string) => `Sent ${date}`,
  /** Said, and focused, on the page a person lands on after sending (QAO-02, QAO-05). */
  justSent: (count: number) => (count > 1 ? "Requests sent." : "Request sent."),
  view: "View request",
  approved: {
    MENTOR: { title: "Mentoring is open", body: "Mentoring is now one of your spaces. Start with Confirm work.", open: "Open Mentoring" },
    INSTITUTION: { title: "Discover is open", body: "Search saved community profiles and explore the work behind them.", open: "Open Discover" },
  } satisfies Record<AccessRole, { title: string; body: string; open: string }>,
  declined: {
    title: { MENTOR: "Mentor access wasn’t approved this time.", INSTITUTION: "Organisation access wasn’t approved this time." } satisfies Record<AccessRole, string>,
    body: "You can still take part as a member, and you can send a new request later.",
    again: "Send a new request",
  },
  dismiss: "Dismiss",
  welcome: {
    title: "Welcome to the community",
    body: "Look around at your own pace. When you’re ready, add your profile and the work you’ve done. You can choose how you take part any time in",
    account: "Account",
  },
  unsaved: "That didn’t save. Try again in a moment.",
} as const;

/** The "Your spaces" line: the spaces a granted role opened, shown in Community. */
export const YOUR_SPACES = {
  title: "Your spaces",
  body: { MENTOR: "Mentoring is open to you.", INSTITUTION: "Discover is open to you.", both: "Mentoring and Discover are open to you." },
  keeps: "Community keeps your own work.",
  open: { MENTOR: "Open Mentoring", INSTITUTION: "Open Discover" } satisfies Record<AccessRole, string>,
} as const;

/** Community for someone who chose to mentor or find people, and not to build and learn. */
export const PARTNER = { title: "Community", ownWork: "Your own work" } as const;

/**
 * The one-time card for accounts from before onboarding (S4). "Not now" hides
 * it for good; nothing the person already has changes either way.
 */
export const PROMPT = {
  title: "How do you take part now?",
  body: "We use this to choose where you start and what we suggest. Nothing you already have changes.",
  save: "Save",
  choose: "Choose",
  notNow: "Not now",
  note: "“Not now” hides this card for good. You can still choose in Account.",
  /** What the page says once the card has gone, so it never just vanishes (QAO-10). */
  saved: "Saved. You can change how you take part any time in",
  hidden: "Card hidden. You can still choose how you take part in",
  account: "Account",
} as const;

/** Account → "How you take part" (S5). Choices are revisitable; access stays the team's decision. */
export const TAKING_PART = {
  title: "How you take part",
  lead: "This shapes where you start and what we suggest. It never grants access by itself.",
  exploring: "Just looking around for now",
  rows: {
    MEMBER: { title: "Build and learn", body: "Community profile, contributions and cohort applications." },
    MENTOR: { title: "Mentor", body: "Review work that members share, and record what you checked." },
    INSTITUTION: { title: "Find people for your organisation", body: "Explore saved community profiles and the evidence behind them." },
  } satisfies Record<ChoiceIntent, { title: string; body: string }>,
  sent: (date: string) => `Request sent ${date}. An administrator will review it.`,
  /** What a pending request said, in the person's own words (QAO-03). The administrator is never named. */
  yours: "What you sent",
  declined: (role: AccessRole) => STATUS.declined.title[role],
  active: { MENTOR: "Mentoring is one of your spaces.", INSTITUTION: "Discover is one of your spaces." } satisfies Record<AccessRole, string>,
  chips: { none: "Not requested", pending: "Pending", declined: "Not approved", active: "Active" },
  request: "Request access",
  withdraw: "Withdraw request",
  again: STATUS.declined.again,
  remove: "Remove",
  note: "Access the team has approved stays on until an administrator removes it. To step back, send the team a note through Feedback.",
} as const;

/**
 * The Profile tab for someone who chose to mentor or find people, and not to build and learn
 * (QA1-08, QAO-07): a public builder profile comes with a completed cohort, so it is explained,
 * not offered as a lock to open by applying.
 */
export const PROFILE_PARTNER = {
  title: "Public profiles come with a cohort",
  body: "A public builder profile opens when a member completes a cohort. To build and learn as well, choose it in",
  account: "Account",
} as const;
