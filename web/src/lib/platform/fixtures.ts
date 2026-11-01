/**
 * SYNTHETIC ONLY. All identities, projects, conversations and counts are fictional.
 * Based on /reports/platform-ux-2026-10-30/screens/01–06 and 08, never production data.
 * Append-only: add a named scenario rather than changing an existing consumer's data.
 */
import type {
  AccessRequestSummary, AdminAccessRequest, AdminAccessRequestList, AttentionCount, AttentionList, AuthorSummary, Channel, ChannelList, FlagsAdmin, Me,
  MentorAvailability, MentorDirectory, MentorRequest, Message, MessageList,
  ModerationQueue, OnboardingState, PersonSummary, ProjectEmbed, RoleBadge, SearchResults,
  SessionClipEmbed, SpaceId, TemboResponse,
} from "./contracts";

export const FIXTURE_NOTICE = "Synthetic demo: fictional people, work and conversations. Not production data.";
export const FIXTURE_NOW = Date.parse("2026-11-03T07:00:00Z");
const minute = 60_000;
const day = 24 * 60 * minute;
// Deterministic CUID2-shaped synthetic ids, deliberately recognisable in screenshots/logs.
const id = (n: number) => `s${String(n).padStart(23, "0")}`;
export const fixtureIds = {
  cohort01: id(101), cohort02: id(102), cohort04: id(104),
  chamaLedger: id(201), fareSplitter: id(202), session09: id(209), session07: id(207),
  acceptedRequest: id(702), pendingRequest: id(701),
};
const badge = (kind: RoleBadge["kind"], label: string, programId: string | null = null): RoleBadge => ({ kind, label, programId });
const person = (n: number, name: string, roleBadges: RoleBadge[]): PersonSummary => ({
  id: id(n), name, avatarUrl: null, roleBadges,
});

export const people = {
  wanjiku: person(1, "Wanjiku Mwangi", [badge("COHORT", "Cohort 04", fixtureIds.cohort04)]),
  achieng: person(2, "Achieng Otieno", [badge("ALUMNI", "Alumni · Cohort 02", fixtureIds.cohort02)]),
  david: person(3, "David Kamau", [badge("MENTOR", "Mentor"), badge("ALUMNI", "Alumni · Cohort 01", fixtureIds.cohort01)]),
  lucy: person(4, "Lucy Chebet", [badge("COMMUNITY", "Community")]),
  joseph: person(5, "Joseph Mutua", [badge("INSTITUTION", "Institution partner"), badge("MENTOR", "Mentor")]),
  amina: person(6, "Amina Hassan", [badge("STAFF", "Staff"), badge("ADMIN", "Admin")]),
  kevin: person(7, "Kevin Omondi", [badge("COHORT", "Cohort 04", fixtureIds.cohort04)]),
  brian: person(8, "Brian Kiprop", [badge("COHORT", "Cohort 04", fixtureIds.cohort04)]),
  faith: person(9, "Faith Njeri", [badge("TA", "TA", fixtureIds.cohort04)]),
  mercy: person(10, "Mercy Wambui", [badge("MENTOR", "Mentor")]),
  samuel: person(11, "Samuel Otieno", [badge("MENTOR", "Mentor")]),
  peter: person(12, "Peter Njoroge", [badge("COMMUNITY", "Community")]),
  collins: person(13, "Collins Mutai", [badge("COMMUNITY", "Community")]),
  dennis: person(14, "Dennis Kiprono", [badge("COMMUNITY", "Community")]),
  // Onboarding personas (/reports/platform-onboarding-2026-11-01). Mercy Wambui and Joseph Mutua above already
  // hold approved roles, so the onboarding Mercy and Joseph are separate people with full-name keys.
  mercyAkinyi: person(15, "Mercy Akinyi", [badge("COMMUNITY", "Community")]),
  josephOchieng: person(16, "Joseph Ochieng", [badge("COMMUNITY", "Community")]),
  wairimu: person(17, "Wairimu Ndung'u", [badge("COMMUNITY", "Community")]),
};
export const temboAuthor: AuthorSummary = {
  id: null, name: "Tembo", avatarUrl: null, roleBadges: [badge("AI", "AI")],
};
const zeroUnread = { cohort: 0, community: 0, mentoring: 0, discover: 0, admin: 0, profile: 0 };
function me(user: PersonSummary, spaces: SpaceId[], overrides: Partial<Me> = {}): Me {
  return {
    user, spaces, unreadCounts: { ...zeroUnread },
    flags: { spaces: true, channels: true, tembo_channels: true, mentor_requests: true, onboarding: true },
    capabilities: { cohortIds: [], mentorCohortIds: [], isMentor: false, isInstitution: false, isAdmin: false },
    temboUsage: { used: 0, limit: 10 }, ...overrides,
  };
}
const cohortCapabilities = {
  cohortIds: [fixtureIds.cohort04], mentorCohortIds: [], isMentor: false, isInstitution: false, isAdmin: false,
};
export const meByPersona = {
  wanjiku: me(people.wanjiku, ["cohort", "community", "profile"], {
    capabilities: cohortCapabilities, unreadCounts: { ...zeroUnread, cohort: 2, community: 2 }, temboUsage: { used: 6, limit: 10 },
  }),
  achieng: me(people.achieng, ["cohort", "community", "profile"], {
    capabilities: { ...cohortCapabilities, cohortIds: [fixtureIds.cohort02] },
  }),
  david: me(people.david, ["cohort", "community", "mentoring", "profile"], {
    capabilities: { ...cohortCapabilities, cohortIds: [fixtureIds.cohort01], isMentor: true },
    unreadCounts: { ...zeroUnread, mentoring: 2, community: 1 },
  }),
  lucy: me(people.lucy, ["community", "profile"]),
  joseph: me(people.joseph, ["community", "mentoring", "discover", "profile"], {
    capabilities: { cohortIds: [], mentorCohortIds: [], isMentor: true, isInstitution: true, isAdmin: false },
  }),
  amina: me(people.amina, ["cohort", "community", "discover", "admin", "profile"], {
    capabilities: { cohortIds: [], mentorCohortIds: [], isMentor: false, isInstitution: false, isAdmin: true },
    unreadCounts: { ...zeroUnread, admin: 3 },
  }),
  kevin: me(people.kevin, ["cohort", "community", "profile"], { capabilities: cohortCapabilities }),
  brian: me(people.brian, ["cohort", "community", "profile"], { capabilities: cohortCapabilities }),
  faith: me(people.faith, ["cohort", "community", "profile"], { capabilities: cohortCapabilities }),
  mercy: me(people.mercy, ["community", "mentoring", "profile"], {
    capabilities: { cohortIds: [], mentorCohortIds: [], isMentor: true, isInstitution: false, isAdmin: false },
  }),
  samuel: me(people.samuel, ["community", "mentoring", "profile"], {
    capabilities: { cohortIds: [], mentorCohortIds: [], isMentor: true, isInstitution: false, isAdmin: false },
  }),
  peter: me(people.peter, ["community", "profile"]),
  collins: me(people.collins, ["community", "profile"]),
  dennis: me(people.dennis, ["community", "profile"]),
  // A pending request grants nothing: these three have exactly Lucy's spaces and capabilities.
  mercyAkinyi: me(people.mercyAkinyi, ["community", "profile"]),
  josephOchieng: me(people.josephOchieng, ["community", "profile"]),
  wairimu: me(people.wairimu, ["community", "profile"]),
} satisfies Record<keyof typeof people, Me>;

function channel(n: number, slug: string, overrides: Partial<Channel> = {}): Channel {
  return {
    id: id(n), kind: "COMMUNITY", slug, name: slug, topic: "A place to share and learn together.",
    postingPolicy: "ALL", programId: null, unreadCount: 0, lastMessageAt: null, archivedAt: null,
    capabilities: { canPost: true, canModerate: false, canShareSessionClip: false }, ...overrides,
  };
}
export const channels = {
  introductions: channel(301, "introductions"),
  showYourWork: channel(302, "show-your-work", {
    topic: "Share what you're building and ask for a second pair of eyes.", lastMessageAt: FIXTURE_NOW - minute,
  }),
  help: channel(303, "help", { unreadCount: 3 }),
  opportunities: channel(304, "opportunities", { unreadCount: 12 }),
  designCrit: channel(305, "design-crit"),
  cohort04: channel(306, "cohort-04", {
    kind: "COHORT", programId: fixtureIds.cohort04,
    topic: "Builders, Faith and the instructors. Only Cohort 04 can read this.",
    capabilities: { canPost: true, canModerate: false, canShareSessionClip: true }, lastMessageAt: FIXTURE_NOW - 2 * minute,
  }),
  cohortHelp: channel(307, "c04-help", {
    kind: "COHORT", programId: fixtureIds.cohort04, unreadCount: 2,
    capabilities: { canPost: true, canModerate: false, canShareSessionClip: true },
  }),
  cohortAnnouncements: channel(308, "c04-announcements", {
    kind: "COHORT", programId: fixtureIds.cohort04, postingPolicy: "STAFF",
    capabilities: { canPost: false, canModerate: false, canShareSessionClip: false },
  }),
  davidConversation: channel(309, "portfolio-review", { kind: "DIRECT", name: "David Kamau", unreadCount: 1 }),
};
export const channelList: ChannelList = { items: Object.values(channels) };
export const projects = {
  chamaLedger: {
    type: "project", journeyId: fixtureIds.chamaLedger, version: 3,
    title: "Chama ledger: M-Pesa receipt parser",
    summary: "Turns C2B callbacks and SMS receipts into one shared ledger for a savings group. Idempotent on the transaction code.",
    skills: ["TypeScript", "Cloudflare Workers", "D1"], link: "https://example.com/synthetic/achieng/chama-ledger",
    confirmations: [{ mentorId: people.david.id, mentorName: people.david.name, version: 2 }],
  },
  fareSplitter: {
    type: "project", journeyId: fixtureIds.fareSplitter, version: 4, title: "Bus fare splitter",
    summary: "Splits matatu fares across a group and settles through M-Pesa.", skills: ["TypeScript", "Hono", "D1"],
    link: "https://example.com/synthetic/wanjiku/fare-split",
    confirmations: [{ mentorId: people.mercy.id, mentorName: people.mercy.name, version: 4 }],
  },
} satisfies Record<string, ProjectEmbed>;
export const sessionClip: SessionClipEmbed = {
  type: "sessionClip", recordingId: fixtureIds.session09, title: "Session 9 · Webhooks and retries",
  startSeconds: 2052, durationSeconds: 90,
  quote: "If the provider sends the same callback twice, the second one should change nothing.",
};
const projectPath = `/dashboard/community/projects/${fixtureIds.chamaLedger}`;
const sessionPath = `/dashboard/cohort/sessions/${fixtureIds.session09}?t=2052`;
const messagePath = (c: Channel, messageId: string) => `/dashboard/${c.kind === "COHORT" ? "cohort" : "community"}/c/${c.slug}?message=${messageId}`;
function message(n: number, c: Channel, author: AuthorSummary, body: string, overrides: Partial<Message> = {}): Message {
  return {
    id: id(n), channelId: c.id, parentId: null, clientNonce: `synthetic-${n}`,
    authorKind: "USER", author, body, embeds: [], citations: [], reactions: [],
    createdAt: FIXTURE_NOW - day, edited: false, deleted: false, moderation: null,
    thread: { replyCount: 0, participantIds: [], lastReplyAt: null }, temboScope: null, ...overrides,
  };
}
const communityParent = id(401);
const cohortParent = id(412);
export const messages = {
  projectPost: message(401, channels.showYourWork, people.achieng,
    "Finally shipped the M-Pesa receipt parser for our chama. Would love eyes on how I handle duplicate callbacks before more groups start using it.", {
      embeds: [projects.chamaLedger], reactions: [{ kind: "useful", count: 6, mine: true }, { kind: "learned", count: 4, mine: false }],
      thread: { replyCount: 5, participantIds: [people.david.id, people.achieng.id, people.kevin.id, people.wanjiku.id], lastReplyAt: FIXTURE_NOW - 60 * minute },
    }),
  mentorReply: message(402, channels.showYourWork, people.david,
    "The unique index on the transaction code is right, but you return a 500 on the duplicate, so the provider keeps retrying. Return 200 and log it instead.",
    { parentId: communityParent, createdAt: FIXTURE_NOW - day + minute }),
  authorReply: message(403, channels.showYourWork, people.achieng,
    "Good catch. Fixed in revision 3, and I added a replay test.", { parentId: communityParent, edited: true, createdAt: FIXTURE_NOW - day + 2 * minute }),
  kevinReply: message(404, channels.showYourWork, people.kevin,
    "The replay test makes this much easier to follow. Thanks for sharing it.", { parentId: communityParent, createdAt: FIXTURE_NOW - 90 * minute }),
  communityAsk: message(405, channels.showYourWork, people.wanjiku,
    "@tembo what changed between the two revisions?", { parentId: communityParent, createdAt: FIXTURE_NOW - 61 * minute }),
  communityAnswer: message(406, channels.showYourWork, temboAuthor,
    "Revision 3 returns 200 for a repeated transaction code and logs the raw callback before parsing. David's confirmation covers revision 2, so it doesn't yet cover this change.", {
      authorKind: "TEMBO", clientNonce: null, parentId: communityParent, temboScope: "COMMUNITY", createdAt: FIXTURE_NOW - 60 * minute,
      citations: [
        { type: "project", journeyId: fixtureIds.chamaLedger, version: 3, title: "Chama ledger · rev 3", href: projectPath },
        { type: "message", messageId: id(403), channelId: channels.showYourWork.id, title: "This thread", href: messagePath(channels.showYourWork, id(403)) },
      ],
    }),
  firstPr: message(407, channels.showYourWork, people.brian,
    "My first PR to an open-source project got merged this morning. Small docs fix, but it counts.", {
      createdAt: FIXTURE_NOW - 30 * minute, reactions: [{ kind: "congrats", count: 11, mine: false }],
    }),
  mentorOffer: message(408, channels.showYourWork, people.mercy,
    "I have two portfolio review spots open in November. Ask through Mentors with a link to what you want reviewed.", { createdAt: FIXTURE_NOW - minute }),
  recordingPost: message(410, channels.cohort04, people.faith,
    "The Session 9 recording is up. The part on retries starts around 34 minutes.", { embeds: [sessionClip], createdAt: FIXTURE_NOW - 180 * minute }),
  duplicateQuestion: message(411, channels.cohort04, people.kevin,
    "Can someone explain why we return 200 on a duplicate? It feels like hiding an error.", { createdAt: FIXTURE_NOW - 170 * minute }),
  cohortAsk: message(412, channels.cohort04, people.wanjiku, "@tembo explain it the way the session did?", {
    createdAt: FIXTURE_NOW - 165 * minute,
    thread: { replyCount: 3, participantIds: [people.faith.id, people.kevin.id], lastReplyAt: FIXTURE_NOW - 155 * minute },
  }),
  cohortAnswer: message(413, channels.cohort04, temboAuthor,
    'The 200 tells the provider "I have this one", so it stops retrying. Nothing is hidden: the duplicate already succeeded the first time. In Session 9 Faith logs the raw callback first, so a real failure can still be replayed.', {
      authorKind: "TEMBO", clientNonce: null, parentId: cohortParent, temboScope: "COHORT", createdAt: FIXTURE_NOW - 164 * minute,
      citations: [
        { type: "sessionClip", recordingId: fixtureIds.session09, startSeconds: 2052, title: "Session 9 · 34:12", href: sessionPath },
        { type: "sessionClip", recordingId: fixtureIds.session07, startSeconds: 1120, title: "Session 7 · 18:40", href: `/dashboard/cohort/sessions/${fixtureIds.session07}?t=1120` },
      ],
    }),
  faithReply: message(414, channels.cohort04, people.faith,
    "Spot on. On Thursday we'll break one on purpose and replay it.", { parentId: cohortParent, createdAt: FIXTURE_NOW - 160 * minute }),
  kevinThanks: message(415, channels.cohort04, people.kevin,
    "Thanks, I understand why a duplicate is different from a failed payment now.", { parentId: cohortParent, createdAt: FIXTURE_NOW - 155 * minute }),
  // Task definition overrides screen 02: Lucy has no cohort. Brian asks this instead.
  sessionTime: message(416, channels.cohort04, people.brian,
    "Is Thursday's session still at 18:00? I'll be on the matatu until about 17:45.", { createdAt: FIXTURE_NOW - 150 * minute }),
  sessionTimeReply: message(417, channels.cohort04, people.faith,
    "Yes, 18:00. The recording will be up the same night if you're late.", {
      createdAt: FIXTURE_NOW - 148 * minute, reactions: [{ kind: "thanks", count: 4, mine: false }],
    }),
  mention: message(418, channels.cohort04, people.faith,
    "@Wanjiku can you share your replay test?", { createdAt: FIXTURE_NOW - 25 * minute }),
  helpQuestion: message(419, channels.help, people.kevin,
    "Anyone have a good pattern for retrying webhooks without double-writing?", { createdAt: FIXTURE_NOW - 2 * day }),
  deleted: message(420, channels.showYourWork, people.brian, "", { deleted: true }),
  flagged: message(421, channels.opportunities, people.peter,
    "Anyone who wants paid work this weekend, contact me at synthetic@example.com.", {
      moderation: { state: "FLAGGED", reasons: ["Contact details"] },
    }),
  reported: message(422, channels.introductions, people.collins,
    "Hi all! Check out my unrelated trading promotion.", { moderation: { state: "VISIBLE", reasons: [] } }),
  hidden: message(423, channels.showYourWork, people.dennis,
    "This is a beginner mistake, honestly not worth discussing.", {
      moderation: { state: "HIDDEN", reasons: ["Harsh, not about the work"] },
    }),
};
export const communityMessages: MessageList = {
  items: [messages.projectPost, messages.firstPr, messages.mentorOffer], beforeCursor: "synthetic-community-before",
  sinceCursor: "synthetic-community-since", thread: null, removedIds: [],
};
export const communityThread: MessageList = {
  items: [messages.mentorReply, messages.authorReply, messages.kevinReply, messages.communityAsk, messages.communityAnswer],
  beforeCursor: null, sinceCursor: "synthetic-community-thread-since", thread: communityParent, removedIds: [],
};
export const cohortMessages: MessageList = {
  items: [messages.recordingPost, messages.duplicateQuestion, messages.cohortAsk, messages.sessionTime, messages.sessionTimeReply, messages.mention],
  beforeCursor: null, sinceCursor: "synthetic-cohort-since", thread: null, removedIds: [],
};
export const cohortThread: MessageList = {
  items: [messages.cohortAnswer, messages.faithReply, messages.kevinThanks],
  beforeCursor: null, sinceCursor: "synthetic-cohort-thread-since", thread: cohortParent, removedIds: [],
};
/** Ordinary-reader delta after moderation hides a previously cached message. */
export const hiddenMessageDelta: MessageList = {
  items: [], removedIds: [messages.hidden.id], beforeCursor: null,
  sinceCursor: "synthetic-community-after-hide", thread: null,
};

export const attention: AttentionList = {
  snapshotAt: FIXTURE_NOW, nextCursor: null,
  items: [
    { id: id(501), kind: "mentor_accepted", space: "community", actor: people.david,
      subject: { kind: "mentorRequest", id: fixtureIds.acceptedRequest, href: `/dashboard/community/dm/${channels.davidConversation.id}`, label: "Conversation with David" },
      summary: "David Kamau accepted your request for a portfolio review", createdAt: FIXTURE_NOW - 10 * minute, readAt: null },
    { id: id(502), kind: "mention", space: "cohort", actor: people.faith,
      subject: { kind: "message", id: messages.mention.id, href: messagePath(channels.cohort04, messages.mention.id), label: "Cohort 04 · #cohort-04" },
      summary: "Faith Njeri mentioned you: @Wanjiku can you share your replay test?", createdAt: FIXTURE_NOW - 25 * minute, readAt: null },
    { id: id(503), kind: "tembo_answer", space: "community", actor: temboAuthor,
      subject: { kind: "message", id: messages.communityAnswer.id, href: messagePath(channels.showYourWork, messages.communityAnswer.id), label: "#show-your-work" },
      summary: "Tembo answered your question in a thread", createdAt: FIXTURE_NOW - 60 * minute, readAt: null },
    { id: id(504), kind: "recording_ready", space: "cohort", actor: null,
      subject: { kind: "recording", id: fixtureIds.session09, href: sessionPath, label: "Session 9 · Webhooks and retries" },
      summary: "Session 9 · Webhooks and retries is ready to watch", createdAt: FIXTURE_NOW - 180 * minute, readAt: null },
    { id: id(505), kind: "work_confirmed", space: "profile", actor: people.mercy,
      subject: { kind: "journey", id: fixtureIds.fareSplitter, href: `/dashboard/me/projects/${fixtureIds.fareSplitter}`, label: "Bus fare splitter · revision 4" },
      summary: "Mercy Wambui confirmed your contribution at revision 4", createdAt: FIXTURE_NOW - day, readAt: FIXTURE_NOW - 12 * minute },
    { id: id(506), kind: "reply", space: "community", actor: people.kevin,
      subject: { kind: "message", id: messages.helpQuestion.id, href: messagePath(channels.help, messages.helpQuestion.id), label: "#help" },
      summary: "Kevin Omondi replied in #help", createdAt: FIXTURE_NOW - 2 * day, readAt: FIXTURE_NOW - day },
  ],
};
export const attentionCount: AttentionCount = { count: 4, unreadCounts: { ...zeroUnread, cohort: 2, community: 2 } };
export const searchResults: SearchResults = {
  query: { q: "retry webhook", scope: "all" },
  messages: [messages.mentorReply, messages.helpQuestion].map((m) => ({
    id: m.id, channelId: m.channelId, parentId: m.parentId, author: m.author, excerpt: m.body,
    href: messagePath(m.channelId === channels.help.id ? channels.help : channels.showYourWork, m.id),
    createdAt: m.createdAt, visibility: { kind: "COMMUNITY", label: "Community · signed-in members" },
  })),
  people: [{ person: people.david, bio: "Mentor · Backend engineer · open to code review and API design",
    href: "/dashboard/community/mentors", visibility: { kind: "COMMUNITY", label: "Community · Mentors" } }],
  projects: [{ journeyId: fixtureIds.chamaLedger, version: 3, title: projects.chamaLedger.title,
    summary: "Idempotent webhook handling · 1 mentor confirmation (revision 2)", owner: people.achieng,
    href: projectPath, visibility: { kind: "PUBLIC", label: "Public project" } }],
  sessionMoments: [{ recordingId: fixtureIds.session09, programId: fixtureIds.cohort04,
    title: sessionClip.title, startSeconds: sessionClip.startSeconds, quote: sessionClip.quote, href: sessionPath,
    visibility: { kind: "COHORT", label: "Cohort 04 · only you and your cohort see this" } }],
};

export const mentors: MentorDirectory = {
  items: [
    { person: people.david, headline: "Backend engineer · fintech", areas: ["Code review", "API design"],
      bio: "Reviews APIs and data models. Cares about what happens when those things fail.",
      capacity: { used: 1, limit: 3, nextOpeningAt: null }, paused: false },
    { person: people.mercy, headline: "Product designer", areas: ["Portfolios", "UX critique"],
      bio: "Portfolio reviews and UX critique for builders who design their own screens.",
      capacity: { used: 2, limit: 2, nextOpeningAt: Date.parse("2026-11-30T21:00:00Z") }, paused: false },
    { person: people.joseph, headline: "Engineering manager", areas: ["Career", "Interviews"],
      bio: "Career conversations, interviewing and the first months in a new job.",
      capacity: { used: 1, limit: 2, nextOpeningAt: null }, paused: false },
    { person: people.samuel, headline: "Android engineer", areas: ["Mobile", "Kotlin"],
      bio: "Kotlin, offline-first apps and shipping to low-end devices.",
      capacity: { used: 0, limit: 3, nextOpeningAt: null }, paused: false },
  ],
};
export const pendingMentorRequest: MentorRequest = {
  id: fixtureIds.pendingRequest, requester: people.wanjiku, mentor: people.david,
  note: "I rebuilt my bus fare splitter after Session 9. Could you check how I handle a payment callback that arrives twice?",
  project: projects.fareSplitter, format: "WRITTEN_REVIEW", status: "PENDING", channelId: null, redirectedTo: null,
  createdAt: FIXTURE_NOW - 120 * minute, updatedAt: FIXTURE_NOW - 120 * minute,
};
// An earlier, separate request for the attention panel; not a duplicate pending request.
export const acceptedMentorRequest: MentorRequest = {
  ...pendingMentorRequest, id: fixtureIds.acceptedRequest, note: "Could we review my project portfolio together?",
  status: "ACCEPTED", channelId: channels.davidConversation.id, createdAt: FIXTURE_NOW - 3 * day, updatedAt: FIXTURE_NOW - 10 * minute,
};
export const brianMentorRequest: MentorRequest = {
  ...pendingMentorRequest, id: id(703), requester: people.brian, project: null, format: "CALL_30_MIN",
  note: "I have two offers, one at an agency and one at a fintech. Could we talk through how to choose?",
  createdAt: FIXTURE_NOW - day, updatedAt: FIXTURE_NOW - day,
};
export const availability: MentorAvailability = {
  monthlyCapacity: 3, areas: ["Code review", "API design"], bio: mentors.items[0].bio,
  paused: false, capacity: { used: 1, limit: 3, nextOpeningAt: null },
};
export const moderationQueue: ModerationQueue = {
  nextCursor: null,
  items: [
    { id: id(801), message: messages.flagged, channel: channels.opportunities, source: "AI_FLAG",
      reasons: ["Contact details"], state: "PENDING", reportCount: 0, actor: null, createdAt: FIXTURE_NOW - 10 * minute },
    { id: id(802), message: messages.reported, channel: channels.introductions, source: "REPORT",
      reasons: ["Unrelated promotion"], state: "PENDING", reportCount: 2, actor: null, createdAt: FIXTURE_NOW - 20 * minute },
    { id: id(803), message: messages.hidden, channel: channels.showYourWork, source: "MENTOR_HIDE",
      reasons: ["Harsh, not about the work"], state: "PENDING", reportCount: 0, actor: people.david, createdAt: FIXTURE_NOW - 30 * minute },
  ],
};
export const temboPending: TemboResponse = { status: "pending", messageId: messages.communityAsk.id, usage: { used: 6, limit: 10 } };
export const temboAnswer: TemboResponse = { status: "answer", message: messages.communityAnswer, usage: { used: 6, limit: 10 } };
export const flagsAdmin: FlagsAdmin = {
  flags: [
    { key: "spaces", audience: "OFF", updatedAt: FIXTURE_NOW, updatedBy: null },
    { key: "channels", audience: "OFF", updatedAt: FIXTURE_NOW, updatedBy: null },
    { key: "tembo_channels", audience: "OFF", updatedAt: FIXTURE_NOW, updatedBy: null },
    { key: "mentor_requests", audience: "OFF", updatedAt: FIXTURE_NOW, updatedBy: null },
    { key: "onboarding", audience: "OFF", updatedAt: FIXTURE_NOW, updatedBy: null },
  ],
};

// Onboarding (/reports/platform-onboarding-2026-11-01/SPEC.md §2, §7): Mercy chose member + mentor and waits,
// Joseph asks for institution access, Peter's mentor request was declined, and Wairimu has just signed up.
const accessRequestIds = { mercyMentor: id(901), josephInstitution: id(902), peterMentor: id(903) };
export const accessRequests = {
  mercyMentor: {
    id: accessRequestIds.mercyMentor, role: "MENTOR", status: "PENDING",
    note: "I build Flutter apps at work and would like to review the mobile projects members share.",
    organisation: null, organisationRole: null, link: "https://example.com/synthetic/mercy-akinyi/portfolio",
    decisionMessage: null, createdAt: FIXTURE_NOW - 2 * day, updatedAt: FIXTURE_NOW - 2 * day, decidedAt: null, seenAt: null,
  },
  josephInstitution: {
    id: accessRequestIds.josephInstitution, role: "INSTITUTION", status: "PENDING",
    note: "We want to find junior mobile developers whose shared work shows offline-first apps.",
    organisation: "Mto Labs", organisationRole: "Engineering lead", link: "https://example.com/synthetic/mto-labs",
    decisionMessage: null, createdAt: FIXTURE_NOW - day, updatedAt: FIXTURE_NOW - day, decidedAt: null, seenAt: null,
  },
  peterMentor: {
    id: accessRequestIds.peterMentor, role: "MENTOR", status: "DECLINED",
    note: "I have built USSD and SMS tools for three years and could review backend work members share.",
    organisation: null, organisationRole: null, link: null,
    decisionMessage: "Thanks for offering, Peter. We can't add this right now.",
    createdAt: FIXTURE_NOW - 10 * day, updatedAt: FIXTURE_NOW - 3 * day, decidedAt: FIXTURE_NOW - 3 * day, seenAt: null,
  },
} satisfies Record<string, AccessRequestSummary>;
export const onboardingByPersona = {
  mercyAkinyi: { stage: "DONE", intents: ["MEMBER", "MENTOR"], inferred: [], requests: [accessRequests.mercyMentor], roles: [] },
  josephOchieng: { stage: "DONE", intents: ["INSTITUTION"], inferred: [], requests: [accessRequests.josephInstitution], roles: [] },
  // A decline keeps the intent, so the declined card and Account can offer a new request.
  peter: { stage: "DONE", intents: ["MENTOR"], inferred: [], requests: [accessRequests.peterMentor], roles: [] },
  wairimu: { stage: "NEW", intents: [], inferred: [], requests: [], roles: [] },
} satisfies Partial<Record<keyof typeof people, OnboardingState>>;
const adminView = (summary: AccessRequestSummary, requester: PersonSummary, githubLogin: string,
  overrides: Partial<AdminAccessRequest> = {}): AdminAccessRequest => {
  const { seenAt: _seenAt, ...shared } = summary;
  return {
    ...shared, requester, githubLogin, decidedBy: null, earlierRequests: [],
    scopeAcknowledgedAt: summary.role === "INSTITUTION" ? summary.createdAt : null, ...overrides,
  };
};
export const adminAccessRequests = {
  pending: {
    pendingCount: 2, nextCursor: null,
    items: [
      adminView(accessRequests.josephInstitution, people.josephOchieng, "synthetic-joseph-ochieng"),
      adminView(accessRequests.mercyMentor, people.mercyAkinyi, "synthetic-mercy-akinyi"),
    ],
  },
  decided: {
    pendingCount: 2, nextCursor: null,
    items: [adminView(accessRequests.peterMentor, people.peter, "synthetic-peter-njoroge", { decidedBy: people.amina })],
  },
} satisfies Record<string, AdminAccessRequestList>;
const accessRequestHref = "/dashboard/account#taking-part";
export const accessAttention = {
  // Amina's admin Attention group: one item per pending request, from the requester.
  amina: {
    snapshotAt: FIXTURE_NOW, nextCursor: null,
    items: [
      { id: id(911), kind: "access_request", space: "admin", actor: people.josephOchieng,
        subject: { kind: "accessRequest", id: accessRequests.josephInstitution.id, href: "/admin/access-requests", label: "Institution access" },
        summary: "Joseph Ochieng asked for institution access", createdAt: accessRequests.josephInstitution.createdAt, readAt: null },
      { id: id(912), kind: "access_request", space: "admin", actor: people.mercyAkinyi,
        subject: { kind: "accessRequest", id: accessRequests.mercyMentor.id, href: "/admin/access-requests", label: "Mentor access" },
        summary: "Mercy Akinyi asked for mentor access", createdAt: accessRequests.mercyMentor.createdAt, readAt: null },
    ],
  },
  // Peter's decision arrives without an actor: the requester never learns which administrator decided.
  peter: {
    snapshotAt: FIXTURE_NOW, nextCursor: null,
    items: [
      { id: id(913), kind: "access_decided", space: "community", actor: null,
        subject: { kind: "accessRequest", id: accessRequests.peterMentor.id, href: accessRequestHref, label: "Mentor access" },
        summary: "Mentor access wasn't approved this time", createdAt: FIXTURE_NOW - 3 * day, readAt: null },
    ],
  },
} satisfies Record<string, AttentionList>;
