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
