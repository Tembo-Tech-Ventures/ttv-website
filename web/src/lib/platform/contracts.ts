import { z } from "zod";

/** Wire contracts only. No handlers, database dependencies, or access decisions. */
export interface RouteDef<P = unknown, Q = unknown, B = unknown, R = unknown> {
  method: "GET" | "POST" | "PATCH" | "PUT" | "DELETE";
  path: string;
  params?: z.ZodType<P>;
  query?: z.ZodType<Q>;
  body?: z.ZodType<B>;
  response: z.ZodType<R>;
  idempotent?: boolean;
}
export const defineRoute = <P, Q, B, R>(r: RouteDef<P, Q, B, R>) => r;

/** Existing auth, imported and synthetic ids are opaque; format grants no access. */
export const Id = z.string().min(1).max(255);
export type Id = z.infer<typeof Id>;
export const Timestamp = z.int().nonnegative().max(8_640_000_000_000_000);
export type Timestamp = z.infer<typeof Timestamp>;
export const Count = z.int().nonnegative();
export type Count = z.infer<typeof Count>;
/** Opaque server token. Resource ids are not chronological cursors. */
export const Cursor = z.string().min(1).max(2048);
export type Cursor = z.infer<typeof Cursor>;
export const ClientNonce = z.string().min(1).max(128).regex(/^[A-Za-z0-9_-]+$/);
export type ClientNonce = z.infer<typeof ClientNonce>;
export const NonEmptyText = z.string().min(1).refine((s) => s.trim().length > 0, "Must contain text");
export type NonEmptyText = z.infer<typeof NonEmptyText>;
export const MarkdownBody = NonEmptyText.max(10_000);
export type MarkdownBody = z.infer<typeof MarkdownBody>;
export const InternalPath = z.string().regex(/^\/(?!\/)[^\\\s]*$/);
export type InternalPath = z.infer<typeof InternalPath>;
export const WebLink = z.union([InternalPath, z.url({ protocol: /^https?$/ })]);
export type WebLink = z.infer<typeof WebLink>;
export const IdParams = z.strictObject({ id: Id });
export type IdParams = z.infer<typeof IdParams>;
export const Success = z.object({ ok: z.literal(true) });
export type Success = z.infer<typeof Success>;

/** conduct_required (HTTP 403): agree to the current channel code of conduct, then post again. */
export const ErrorCode = z.enum([
  "not_found", "forbidden", "flag_off", "validation", "rate_limited",
  "quota_exhausted", "conflict", "moderation_rejected", "conduct_required", "server",
]);
export type ErrorCode = z.infer<typeof ErrorCode>;
export const ErrorEnvelope = z.object({
  error: z.object({ code: ErrorCode, message: NonEmptyText, retryAfterMs: Count.optional() }),
});
export type ErrorEnvelope = z.infer<typeof ErrorEnvelope>;

export const SPACE_ORDER = ["cohort", "community", "mentoring", "discover", "admin", "profile"] as const;
export const SpaceId = z.enum(SPACE_ORDER);
export type SpaceId = z.infer<typeof SpaceId>;
/** onboarding is effective only while spaces is (onboarding SPEC §6). */
export const FlagKey = z.enum(["spaces", "channels", "tembo_channels", "mentor_requests", "onboarding"]);
export type FlagKey = z.infer<typeof FlagKey>;
export const FlagAudience = z.enum(["OFF", "STAFF", "ALL"]);
export type FlagAudience = z.infer<typeof FlagAudience>;
export const Flag = z.object({ key: FlagKey, audience: FlagAudience, updatedAt: Timestamp, updatedBy: Id.nullable() });
export type Flag = z.infer<typeof Flag>;
export const EffectiveFlags = z.record(FlagKey, z.boolean());
export type EffectiveFlags = z.infer<typeof EffectiveFlags>;
export const FlagsAdmin = z.object({ flags: z.array(Flag).length(FlagKey.options.length) })
  .refine((r) => new Set(r.flags.map((f) => f.key)).size === FlagKey.options.length, "Each flag must appear once");
export type FlagsAdmin = z.infer<typeof FlagsAdmin>;
export const FlagParams = z.strictObject({ key: FlagKey });
export type FlagParams = z.infer<typeof FlagParams>;
export const UpdateFlag = z.strictObject({ audience: FlagAudience });
export type UpdateFlag = z.infer<typeof UpdateFlag>;

/** Display badges, not authorization roles. Multiple badges may coexist. */
export const RoleBadgeKind = z.enum([
  "COHORT", "ALUMNI", "COMMUNITY", "MENTOR", "TA", "INSTRUCTOR", "INSTITUTION", "STAFF", "ADMIN", "AI",
]);
export type RoleBadgeKind = z.infer<typeof RoleBadgeKind>;
export const RoleBadge = z.object({ kind: RoleBadgeKind, label: NonEmptyText, programId: Id.nullable() });
export type RoleBadge = z.infer<typeof RoleBadge>;
export const PersonSummary = z.object({
  id: Id, name: NonEmptyText, avatarUrl: WebLink.nullable(), roleBadges: z.array(RoleBadge),
});
export type PersonSummary = z.infer<typeof PersonSummary>;
export const AuthorKind = z.enum(["USER", "TEMBO"]);
export type AuthorKind = z.infer<typeof AuthorKind>;
/** Tembo and anonymised deleted accounts have no user id. */
export const AuthorSummary = PersonSummary.extend({ id: Id.nullable() });
export type AuthorSummary = z.infer<typeof AuthorSummary>;
export const SpaceUnreadCounts = z.record(SpaceId, Count);
export type SpaceUnreadCounts = z.infer<typeof SpaceUnreadCounts>;
export const TemboUsage = z.object({ used: Count, limit: Count });
export type TemboUsage = z.infer<typeof TemboUsage>;
/** Serializable subset; channel-dependent capabilities live on Channel. */
export const Capabilities = z.object({
  cohortIds: z.array(Id), mentorCohortIds: z.array(Id),
  isMentor: z.boolean(), isInstitution: z.boolean(), isAdmin: z.boolean(),
});
export type Capabilities = z.infer<typeof Capabilities>;
/**
 * Derived on each load, not attention: shared contributions this mentor has
 * not confirmed at their current revision, as the Confirm page lists them.
 * Sent only with the Mentoring space; absent means the number is not known.
 */
export const MentoringSummary = z.object({ awaitingConfirmation: Count });
export type MentoringSummary = z.infer<typeof MentoringSummary>;
export const Me = z.object({
  user: PersonSummary, capabilities: Capabilities, spaces: z.array(SpaceId),
  unreadCounts: SpaceUnreadCounts, flags: EffectiveFlags, temboUsage: TemboUsage,
  mentoring: MentoringSummary.optional(),
}).refine((m) => m.spaces.every((space, i) => i === 0 || SPACE_ORDER.indexOf(m.spaces[i - 1]) < SPACE_ORDER.indexOf(space)),
  "Spaces must be unique and in SPACE_ORDER")
  .refine((m) => !m.mentoring || m.spaces.includes("mentoring"), "Mentoring summary needs the Mentoring space");
export type Me = z.infer<typeof Me>;

export const AttentionKind = z.enum([
  "mention", "reply", "tembo_answer", "mentor_request", "mentor_accepted", "mentor_redirected",
  "mentor_declined", "mentor_withdrawn", "recording_ready", "application_status",
  "work_confirmed", "visitor_message", "opportunity_match", "moderation_pending", "message_hidden",
  "access_request", "access_decided",
]);
export type AttentionKind = z.infer<typeof AttentionKind>;
export const SubjectKind = z.enum([
  "message", "channel", "recording", "journey", "mentorRequest", "application", "visitorMessage", "opportunity",
  "accessRequest",
]);
export type SubjectKind = z.infer<typeof SubjectKind>;
export const SubjectRef = z.object({ kind: SubjectKind, id: Id, href: InternalPath, label: NonEmptyText });
export type SubjectRef = z.infer<typeof SubjectRef>;
/** Where each access-request kind is delivered (onboarding SPEC §4): to admins, then back to the requester. */
const ACCESS_ATTENTION_SPACE: Partial<Record<AttentionKind, SpaceId>> = { access_request: "admin", access_decided: "community" };
export const AttentionItem = z.object({
  id: Id, kind: AttentionKind, space: SpaceId, subject: SubjectRef,
  actor: AuthorSummary.nullable(), summary: NonEmptyText, createdAt: Timestamp, readAt: Timestamp.nullable(),
}).refine((a) => {
  const space = ACCESS_ATTENTION_SPACE[a.kind];
  return space === undefined || (a.space === space && a.subject.kind === "accessRequest");
}, "Access request items point at the request, in their own space")
  // Decisions are actor-neutral: the requester is never told which administrator decided.
  .refine((a) => a.kind !== "access_decided" || a.actor === null, "Access decisions never name an actor");
export type AttentionItem = z.infer<typeof AttentionItem>;
export const AttentionFilter = z.enum(["all", "mentions", "requests", "updates"]);
export type AttentionFilter = z.infer<typeof AttentionFilter>;
export const AttentionQuery = z.strictObject({ cursor: Cursor.optional(), filter: AttentionFilter.optional() });
export type AttentionQuery = z.infer<typeof AttentionQuery>;
export const AttentionList = z.object({ items: z.array(AttentionItem), nextCursor: Cursor.nullable(), snapshotAt: Timestamp });
export type AttentionList = z.infer<typeof AttentionList>;
export const AttentionCount = z.object({ count: Count, unreadCounts: SpaceUnreadCounts });
export type AttentionCount = z.infer<typeof AttentionCount>;
/** Mark-all uses a snapshot boundary so newly arriving items remain unread. */
export const MarkAttentionRead = z.union([
  z.strictObject({ ids: z.array(Id).min(1).max(100) }),
  z.strictObject({ through: Timestamp }),
]);
export type MarkAttentionRead = z.infer<typeof MarkAttentionRead>;

export const VisibilityKind = z.enum(["PUBLIC", "COMMUNITY", "COHORT", "DIRECT", "PRIVATE"]);
export type VisibilityKind = z.infer<typeof VisibilityKind>;
export const Visibility = z.object({ kind: VisibilityKind, label: NonEmptyText });
export type Visibility = z.infer<typeof Visibility>;
export const SearchScope = z.enum(["all", "cohort", "community", "messages", "people", "projects", "sessionMoments"]);
export type SearchScope = z.infer<typeof SearchScope>;
export const SearchQuery = z.strictObject({ q: NonEmptyText.max(500), scope: SearchScope, programId: Id.optional() });
export type SearchQuery = z.infer<typeof SearchQuery>;
export const SearchMessage = z.object({
  id: Id, channelId: Id, parentId: Id.nullable(), author: AuthorSummary,
  excerpt: z.string(), href: InternalPath, createdAt: Timestamp, visibility: Visibility,
});
export type SearchMessage = z.infer<typeof SearchMessage>;
export const SearchPerson = z.object({ person: PersonSummary, bio: z.string(), href: InternalPath, visibility: Visibility });
export type SearchPerson = z.infer<typeof SearchPerson>;
export const SearchProject = z.object({
  journeyId: Id, version: z.int().positive(), title: NonEmptyText, summary: z.string(),
  owner: PersonSummary, href: InternalPath, visibility: Visibility,
});
export type SearchProject = z.infer<typeof SearchProject>;
export const SearchSessionMoment = z.object({
  recordingId: Id, programId: Id, title: NonEmptyText, startSeconds: z.number().nonnegative(),
  quote: NonEmptyText, href: InternalPath, visibility: Visibility,
});
export type SearchSessionMoment = z.infer<typeof SearchSessionMoment>;
export const SearchResults = z.object({
  query: SearchQuery, messages: z.array(SearchMessage), people: z.array(SearchPerson),
  projects: z.array(SearchProject), sessionMoments: z.array(SearchSessionMoment),
});
export type SearchResults = z.infer<typeof SearchResults>;

export const ChannelKind = z.enum(["COHORT", "COMMUNITY", "DIRECT"]);
export type ChannelKind = z.infer<typeof ChannelKind>;
export const PostingPolicy = z.enum(["ALL", "STAFF"]);
export type PostingPolicy = z.infer<typeof PostingPolicy>;
export const ChannelCapabilities = z.object({ canPost: z.boolean(), canModerate: z.boolean(), canShareSessionClip: z.boolean() });
export type ChannelCapabilities = z.infer<typeof ChannelCapabilities>;
export const Channel = z.object({
  id: Id, kind: ChannelKind, slug: NonEmptyText, name: NonEmptyText, topic: z.string(),
  postingPolicy: PostingPolicy, programId: Id.nullable(), unreadCount: Count,
  lastMessageAt: Timestamp.nullable(), archivedAt: Timestamp.nullable(), capabilities: ChannelCapabilities,
}).refine((c) => (c.kind === "COHORT") === (c.programId !== null), "Only cohort channels have a programId");
export type Channel = z.infer<typeof Channel>;
export const ChannelList = z.object({ items: z.array(Channel) });
export type ChannelList = z.infer<typeof ChannelList>;
/**
 * The caller's agreement to the channel code of conduct ("How we talk to each other"): the latest
 * version they accepted and when. current is false once a newer version asks everyone again.
 */
export const ConductAcknowledgement = z.object({ version: z.int().positive(), acknowledgedAt: Timestamp, current: z.boolean() });
export type ConductAcknowledgement = z.infer<typeof ConductAcknowledgement>;

export const ProjectConfirmation = z.object({ mentorId: Id, mentorName: NonEmptyText, version: z.int().positive() });
export type ProjectConfirmation = z.infer<typeof ProjectConfirmation>;
export const ProjectEmbed = z.object({
  type: z.literal("project"), journeyId: Id, version: z.int().positive(), title: NonEmptyText,
  summary: z.string(), skills: z.array(NonEmptyText), link: WebLink, confirmations: z.array(ProjectConfirmation),
});
export type ProjectEmbed = z.infer<typeof ProjectEmbed>;
export const SessionClipEmbed = z.object({
  type: z.literal("sessionClip"), recordingId: Id, title: NonEmptyText,
  startSeconds: z.number().nonnegative(), durationSeconds: z.number().positive(), quote: NonEmptyText,
});
export type SessionClipEmbed = z.infer<typeof SessionClipEmbed>;
export const MessageEmbed = z.discriminatedUnion("type", [ProjectEmbed, SessionClipEmbed]);
export type MessageEmbed = z.infer<typeof MessageEmbed>;
/** Writes send references only; the server resolves labels, quotations and confirmations. */
export const ProjectEmbedRef = z.strictObject({ type: z.literal("project"), journeyId: Id, version: z.int().positive() });
export type ProjectEmbedRef = z.infer<typeof ProjectEmbedRef>;
export const SessionClipEmbedRef = z.strictObject({
  type: z.literal("sessionClip"), recordingId: Id, startSeconds: z.number().nonnegative(), durationSeconds: z.number().positive(),
});
export type SessionClipEmbedRef = z.infer<typeof SessionClipEmbedRef>;
export const EmbedRef = z.discriminatedUnion("type", [ProjectEmbedRef, SessionClipEmbedRef]);
export type EmbedRef = z.infer<typeof EmbedRef>;
export const Citation = z.discriminatedUnion("type", [
  z.object({ type: z.literal("project"), journeyId: Id, version: z.int().positive(), title: NonEmptyText, href: InternalPath }),
  z.object({ type: z.literal("sessionClip"), recordingId: Id, startSeconds: z.number().nonnegative(), title: NonEmptyText, href: InternalPath }),
  z.object({ type: z.literal("message"), messageId: Id, channelId: Id, title: NonEmptyText, href: InternalPath }),
]);
export type Citation = z.infer<typeof Citation>;
export const ReactionKind = z.enum(["useful", "learned", "thanks", "agree", "congrats"]);
export type ReactionKind = z.infer<typeof ReactionKind>;
export const Reaction = z.object({ kind: ReactionKind, count: Count, mine: z.boolean() });
export type Reaction = z.infer<typeof Reaction>;
export const ModerationState = z.enum(["VISIBLE", "FLAGGED", "HIDDEN"]);
export type ModerationState = z.infer<typeof ModerationState>;
export const MessageModeration = z.object({ state: ModerationState, reasons: z.array(NonEmptyText) });
export type MessageModeration = z.infer<typeof MessageModeration>;
export const ThreadSummary = z.object({ replyCount: Count, participantIds: z.array(Id), lastReplyAt: Timestamp.nullable() });
export type ThreadSummary = z.infer<typeof ThreadSummary>;
export const TemboScope = z.enum(["COHORT", "COMMUNITY", "DIRECT"]);
export type TemboScope = z.infer<typeof TemboScope>;
export const Message = z.object({
  id: Id, channelId: Id, parentId: Id.nullable(), clientNonce: ClientNonce.nullable(),
  authorKind: AuthorKind, author: AuthorSummary, body: z.string().max(10_000),
  embeds: z.array(MessageEmbed), citations: z.array(Citation), reactions: z.array(Reaction),
  createdAt: Timestamp, edited: z.boolean(), deleted: z.boolean(),
  // Null for ordinary readers. Only authors/moderators receive reasons and state.
  moderation: MessageModeration.nullable(), thread: ThreadSummary, temboScope: TemboScope.nullable(),
}).refine((m) => !m.deleted || (m.body === "" && m.embeds.length === 0 && m.citations.length === 0),
  "Deleted messages contain no body, embeds or citations")
  .refine((m) => m.authorKind === "TEMBO" ? m.author.id === null && m.temboScope !== null : m.temboScope === null,
    "Tembo has no user id and must declare its scope");
export type Message = z.infer<typeof Message>;
export const MessageListQuery = z.strictObject({ before: Cursor.optional(), since: Cursor.optional(), thread: Id.optional() })
  .refine((q) => q.before === undefined || q.since === undefined, "before and since are mutually exclusive");
export type MessageListQuery = z.infer<typeof MessageListQuery>;
export const MessageList = z.object({
  items: z.array(Message), beforeCursor: Cursor.nullable(), sinceCursor: Cursor, thread: Id.nullable(),
  // Polling tombstones remove cached messages without exposing hidden content.
  removedIds: z.array(Id),
}).refine((page) => !page.items.some((item) => page.removedIds.includes(item.id)),
  "A page cannot both return and remove a message");
export type MessageList = z.infer<typeof MessageList>;
export const PostMessage = z.strictObject({
  body: MarkdownBody, clientNonce: ClientNonce, parentId: Id.nullable(), embeds: z.array(EmbedRef).max(5),
});
export type PostMessage = z.infer<typeof PostMessage>;
export const EditMessage = z.strictObject({ body: MarkdownBody });
export type EditMessage = z.infer<typeof EditMessage>;
/** DELETE has path params only and returns the redacted Message placeholder. */
export const DeleteMessage = IdParams;
export type DeleteMessage = z.infer<typeof DeleteMessage>;
/** Set desired membership, never toggle, so retries cannot reverse the reaction. */
export const ReactToMessage = z.strictObject({ kind: ReactionKind, active: z.boolean() });
export type ReactToMessage = z.infer<typeof ReactToMessage>;
export const MessageReactions = z.object({ messageId: Id, reactions: z.array(Reaction) });
export type MessageReactions = z.infer<typeof MessageReactions>;
export const ReportMessage = z.strictObject({ reason: NonEmptyText.max(2000) });
export type ReportMessage = z.infer<typeof ReportMessage>;
export const MarkChannelRead = z.strictObject({ messageId: Id });
export type MarkChannelRead = z.infer<typeof MarkChannelRead>;
export const ChannelRead = z.object({ channelId: Id, lastReadMessageId: Id, unreadCount: Count });
export type ChannelRead = z.infer<typeof ChannelRead>;

export const ModerationSource = z.enum(["AI_FLAG", "REPORT", "MENTOR_HIDE"]);
export type ModerationSource = z.infer<typeof ModerationSource>;
export const ModerationQueueState = z.enum(["PENDING", "DECIDED"]);
export type ModerationQueueState = z.infer<typeof ModerationQueueState>;
export const ModerationQueueItem = z.object({
  id: Id, message: Message, channel: Channel, source: ModerationSource, reasons: z.array(NonEmptyText).min(1),
  state: ModerationQueueState, reportCount: Count, actor: PersonSummary.nullable(), createdAt: Timestamp,
});
export type ModerationQueueItem = z.infer<typeof ModerationQueueItem>;
export const ModerationQueueQuery = z.strictObject({ cursor: Cursor.optional(), state: ModerationQueueState.optional() });
export type ModerationQueueQuery = z.infer<typeof ModerationQueueQuery>;
export const ModerationQueue = z.object({ items: z.array(ModerationQueueItem), nextCursor: Cursor.nullable() });
export type ModerationQueue = z.infer<typeof ModerationQueue>;
export const ModerationActionKind = z.enum(["hide", "restore", "keep"]);
export type ModerationActionKind = z.infer<typeof ModerationActionKind>;
export const ModerationAction = z.strictObject({ action: ModerationActionKind, reason: NonEmptyText.max(2000) });
export type ModerationAction = z.infer<typeof ModerationAction>;
export const ModerationParams = z.strictObject({ messageId: Id });
export type ModerationParams = z.infer<typeof ModerationParams>;

/** One invocation per persisted asking message, including mention-triggered asks. */
export const TemboAsk = z.strictObject({ messageId: Id });
export type TemboAsk = z.infer<typeof TemboAsk>;
export const TemboPending = z.object({ status: z.literal("pending"), messageId: Id, usage: TemboUsage });
export type TemboPending = z.infer<typeof TemboPending>;
export const TemboAnswer = z.object({ status: z.literal("answer"), message: Message, usage: TemboUsage })
  .refine((r) => r.message.authorKind === "TEMBO" && r.message.parentId !== null, "Tembo answers belong in a thread");
export type TemboAnswer = z.infer<typeof TemboAnswer>;
export const TemboResponse = z.discriminatedUnion("status", [TemboPending, TemboAnswer]);
export type TemboResponse = z.infer<typeof TemboResponse>;
export const TemboFeedbackKind = z.enum(["helpful", "not_quite"]);
export type TemboFeedbackKind = z.infer<typeof TemboFeedbackKind>;
export const TemboFeedback = z.strictObject({ feedback: TemboFeedbackKind });
export type TemboFeedback = z.infer<typeof TemboFeedback>;

export const MentorCapacity = z.object({ used: Count, limit: Count, nextOpeningAt: Timestamp.nullable() });
export type MentorCapacity = z.infer<typeof MentorCapacity>;
export const MentorDirectoryItem = z.object({
  person: PersonSummary, headline: NonEmptyText, areas: z.array(NonEmptyText), bio: z.string(),
  capacity: MentorCapacity, paused: z.boolean(),
});
export type MentorDirectoryItem = z.infer<typeof MentorDirectoryItem>;
export const MentorDirectoryQuery = z.strictObject({ area: NonEmptyText.optional(), available: z.boolean().optional() });
export type MentorDirectoryQuery = z.infer<typeof MentorDirectoryQuery>;
export const MentorDirectory = z.object({ items: z.array(MentorDirectoryItem) });
export type MentorDirectory = z.infer<typeof MentorDirectory>;
export const MentorRequestFormat = z.enum(["WRITTEN_REVIEW", "CALL_30_MIN", "QUICK_QUESTION"]);
export type MentorRequestFormat = z.infer<typeof MentorRequestFormat>;
export const MentorRequestStatus = z.enum(["PENDING", "ACCEPTED", "REDIRECTED", "DECLINED", "WITHDRAWN"]);
export type MentorRequestStatus = z.infer<typeof MentorRequestStatus>;
export const CreateMentorRequest = z.strictObject({
  mentorId: Id, note: NonEmptyText.max(2000), project: ProjectEmbedRef.nullable(), format: MentorRequestFormat,
});
export type CreateMentorRequest = z.infer<typeof CreateMentorRequest>;
export const MentorRequest = z.object({
  id: Id, requester: PersonSummary, mentor: PersonSummary, note: NonEmptyText,
  project: ProjectEmbed.nullable(), format: MentorRequestFormat, status: MentorRequestStatus,
  channelId: Id.nullable(), redirectedTo: PersonSummary.nullable(), createdAt: Timestamp, updatedAt: Timestamp,
}).refine((r) => (r.status === "ACCEPTED") === (r.channelId !== null), "Only accepted requests have a conversation")
  .refine((r) => (r.status === "REDIRECTED") === (r.redirectedTo !== null), "Only redirected requests have a target mentor");
export type MentorRequest = z.infer<typeof MentorRequest>;
export const AcceptMentorRequest = z.strictObject({});
export type AcceptMentorRequest = z.infer<typeof AcceptMentorRequest>;
export const RedirectMentorRequest = z.strictObject({ mentorId: Id, note: NonEmptyText.max(2000) });
export type RedirectMentorRequest = z.infer<typeof RedirectMentorRequest>;
export const DeclineMentorRequest = z.strictObject({ note: NonEmptyText.max(2000) });
export type DeclineMentorRequest = z.infer<typeof DeclineMentorRequest>;
export const WithdrawMentorRequest = z.strictObject({});
export type WithdrawMentorRequest = z.infer<typeof WithdrawMentorRequest>;
export const UpdateMentorAvailability = z.strictObject({
  monthlyCapacity: Count, areas: z.array(NonEmptyText).max(20), bio: z.string().max(2000), paused: z.boolean(),
});
export type UpdateMentorAvailability = z.infer<typeof UpdateMentorAvailability>;
export const MentorAvailability = UpdateMentorAvailability.extend({ capacity: MentorCapacity });
export type MentorAvailability = z.infer<typeof MentorAvailability>;

/**
 * Onboarding (/reports/platform-onboarding-2026-11-01/SPEC.md §5). Intents choose routing and copy only;
 * capabilities never read them. Mentor and institution access become requests an administrator decides.
 * "Access request" is deliberately distinct from MentorRequest, which asks a mentor for time.
 */
export const Intent = z.enum(["MEMBER", "MENTOR", "INSTITUTION", "EXPLORING"]);
export type Intent = z.infer<typeof Intent>;
const unique = (values: readonly unknown[]) => new Set(values).size === values.length;
/** Saved intents. EXPLORING stands alone; an empty set after onboarding also reads as exploring. */
export const IntentSet = z.array(Intent).max(Intent.options.length)
  .refine(unique, "Intents must be unique")
  .refine((s) => !s.includes("EXPLORING") || s.length === 1, "EXPLORING cannot be combined with other intents");
export type IntentSet = z.infer<typeof IntentSet>;
/** Read from roles, applications and cohort membership when nothing is saved. Never written, never EXPLORING. */
export const InferredIntent = Intent.exclude(["EXPLORING"]);
export type InferredIntent = z.infer<typeof InferredIntent>;
/** NEW: sent to the welcome step. PROMPT: an account from before rollout, shown the one-time card. */
export const OnboardingStage = z.enum(["NEW", "PROMPT", "DONE"]);
export type OnboardingStage = z.infer<typeof OnboardingStage>;
/** The global roles a person can ask for. No institution types or categories exist. */
export const AccessRole = z.enum(["MENTOR", "INSTITUTION"]);
export type AccessRole = z.infer<typeof AccessRole>;
export const AccessRequestStatus = z.enum(["PENDING", "APPROVED", "DECLINED", "WITHDRAWN"]);
export type AccessRequestStatus = z.infer<typeof AccessRequestStatus>;
const isDecided = (status: AccessRequestStatus) => status === "APPROVED" || status === "DECLINED";
/** What the person wrote: 20 to 600 characters, untrusted, always rendered as plain text. */
export const AccessRequestNote = z.string().max(600).refine((s) => s.trim().length >= 20, "Write at least 20 characters");
export type AccessRequestNote = z.infer<typeof AccessRequestNote>;
const hasNoCredentials = (s: string) => {
  try {
    const url = new URL(s);
    return url.username === "" && url.password === "";
  } catch {
    return false; // Not a URL: the format check has already reported it.
  }
};
/** http(s) without credentials: `https://ttv.example@other.example` reads as one host but opens another. */
export const ExternalLink = z.url({ protocol: /^https?$/ }).max(2048).refine(hasNoCredentials, "Links cannot carry credentials");
export type ExternalLink = z.infer<typeof ExternalLink>;
const OrganisationText = NonEmptyText.max(200);
/** An administrator's optional message, shown to the requester without the administrator's name. */
export const DecisionMessage = NonEmptyText.max(600);
export type DecisionMessage = z.infer<typeof DecisionMessage>;

const CreateMentorAccessRequest = z.strictObject({ role: z.literal("MENTOR"), note: AccessRequestNote, link: ExternalLink.nullable() });
const CreateInstitutionAccessRequest = z.strictObject({
  role: z.literal("INSTITUTION"), note: AccessRequestNote, organisation: OrganisationText,
  organisationRole: OrganisationText.nullable(), link: ExternalLink.nullable(),
  // The person confirmed approval opens saved profiles and shared contributions only, not introductions.
  scopeAcknowledged: z.literal(true),
});
export const CreateAccessRequest = z.discriminatedUnion("role", [CreateMentorAccessRequest, CreateInstitutionAccessRequest]);
export type CreateAccessRequest = z.infer<typeof CreateAccessRequest>;

const accessRequestFields = {
  id: Id, role: AccessRole, status: AccessRequestStatus,
  note: NonEmptyText.max(600), organisation: OrganisationText.nullable(), organisationRole: OrganisationText.nullable(),
  link: ExternalLink.nullable(), decisionMessage: DecisionMessage.nullable(),
  createdAt: Timestamp, updatedAt: Timestamp, decidedAt: Timestamp.nullable(),
};
type AccessRequestCore = z.infer<z.ZodObject<typeof accessRequestFields>>;
const decisionRule = [
  (r: AccessRequestCore) => isDecided(r.status) === (r.decidedAt !== null) && (r.decisionMessage === null || isDecided(r.status)),
  "Only approved or declined requests have a decision time or message",
] as const;
const organisationRule = [
  (r: AccessRequestCore) => (r.role === "INSTITUTION") === (r.organisation !== null) && (r.role === "INSTITUTION" || r.organisationRole === null),
  "Institution requests, and only they, name an organisation",
] as const;
/**
 * The requester's view. It never says which administrator decided: decidedBy stays server-side for audit
 * and, as an unknown key, parsing strips it. seenAt is set by visiting the new space or dismissing the card.
 */
export const AccessRequestSummary = z.object({ ...accessRequestFields, seenAt: Timestamp.nullable() })
  .refine(...decisionRule).refine(...organisationRule)
  .refine((r) => r.seenAt === null || isDecided(r.status), "Only decided requests can be marked seen");
export type AccessRequestSummary = z.infer<typeof AccessRequestSummary>;
/**
 * Browser sessions only. requests holds the latest request per role; roles are the access roles held now,
 * which always win over request state.
 */
export const OnboardingState = z.object({
  stage: OnboardingStage, intents: IntentSet,
  inferred: z.array(InferredIntent).max(InferredIntent.options.length).refine(unique, "Inferred intents must be unique"),
  requests: z.array(AccessRequestSummary).max(AccessRole.options.length),
  roles: z.array(AccessRole).max(AccessRole.options.length).refine(unique, "Roles must be unique"),
}).refine((s) => unique(s.requests.map((r) => r.role)), "Only the latest request per role is listed")
  .refine((s) => s.requests.every((r) => r.status !== "PENDING" || !s.roles.includes(r.role)),
    "A request is never pending beside the role it asks for");
export type OnboardingState = z.infer<typeof OnboardingState>;
/** Saving intents finishes the welcome step or card. dismissPrompt is the card's "Not now". */
export const UpdateOnboarding = z.union([
  z.strictObject({ intents: IntentSet }),
  z.strictObject({ dismissPrompt: z.literal(true) }),
]);
export type UpdateOnboarding = z.infer<typeof UpdateOnboarding>;
export const WithdrawAccessRequest = z.strictObject({});
export type WithdrawAccessRequest = z.infer<typeof WithdrawAccessRequest>;
export const DismissAccessRequest = z.strictObject({});
export type DismissAccessRequest = z.infer<typeof DismissAccessRequest>;

/** An earlier request by the same person, for the admin queue's history. */
export const AccessRequestHistoryItem = z.object({
  id: Id, role: AccessRole, status: AccessRequestStatus.exclude(["PENDING"]),
  decisionMessage: DecisionMessage.nullable(), createdAt: Timestamp, decidedAt: Timestamp.nullable(),
}).refine((r) => isDecided(r.status) === (r.decidedAt !== null), "Only approved or declined requests have a decision time");
export type AccessRequestHistoryItem = z.infer<typeof AccessRequestHistoryItem>;
/** The administrator's view: who asked, and who decided. Never sent to the requester. */
export const AdminAccessRequest = z.object({
  ...accessRequestFields, requester: PersonSummary, githubLogin: NonEmptyText.max(255).nullable(),
  scopeAcknowledgedAt: Timestamp.nullable(), decidedBy: PersonSummary.nullable(),
  earlierRequests: z.array(AccessRequestHistoryItem),
}).refine(...decisionRule).refine(...organisationRule)
  .refine((r) => (r.role === "INSTITUTION") === (r.scopeAcknowledgedAt !== null), "Institution requests, and only they, record the scope acknowledgement")
  // Null after a decision when the deciding account was deleted (decidedBy is ON DELETE SET NULL).
  .refine((r) => r.decidedBy === null || isDecided(r.status), "Only decided requests have a decider");
export type AdminAccessRequest = z.infer<typeof AdminAccessRequest>;
/** PENDING (the default) lists open requests; DECIDED lists approved and declined ones. */
export const AccessRequestQueueState = z.enum(["PENDING", "DECIDED"]);
export type AccessRequestQueueState = z.infer<typeof AccessRequestQueueState>;
export const AdminAccessRequestQuery = z.strictObject({ status: AccessRequestQueueState.optional(), cursor: Cursor.optional() });
export type AdminAccessRequestQuery = z.infer<typeof AdminAccessRequestQuery>;
/** pendingCount counts every open request, whichever list was asked for, for the Admin sidebar. */
export const AdminAccessRequestList = z.object({ items: z.array(AdminAccessRequest), nextCursor: Cursor.nullable(), pendingCount: Count });
export type AdminAccessRequestList = z.infer<typeof AdminAccessRequestList>;
export const AccessDecisionKind = z.enum(["approve", "decline"]);
export type AccessDecisionKind = z.infer<typeof AccessDecisionKind>;
export const AccessDecision = z.strictObject({ decision: AccessDecisionKind, message: DecisionMessage.optional() });
export type AccessDecision = z.infer<typeof AccessDecision>;

/** These are contracts for future handlers, not installed API routes. */
export const ROUTES = {
  getMe: defineRoute({ method: "GET", path: "/api/platform/me", response: Me, idempotent: true }),
  listAttention: defineRoute({ method: "GET", path: "/api/attention", query: AttentionQuery, response: AttentionList, idempotent: true }),
  countAttention: defineRoute({ method: "GET", path: "/api/attention/count", response: AttentionCount, idempotent: true }),
  markAttentionRead: defineRoute({ method: "POST", path: "/api/attention/read", body: MarkAttentionRead, response: AttentionCount, idempotent: true }),
  search: defineRoute({ method: "GET", path: "/api/search", query: SearchQuery, response: SearchResults, idempotent: true }),
  listChannels: defineRoute({ method: "GET", path: "/api/channels", response: ChannelList, idempotent: true }),
  listMessages: defineRoute({ method: "GET", path: "/api/channels/:id/messages", params: IdParams, query: MessageListQuery, response: MessageList, idempotent: true }),
  postMessage: defineRoute({ method: "POST", path: "/api/channels/:id/messages", params: IdParams, body: PostMessage, response: Message, idempotent: true }),
  editMessage: defineRoute({ method: "PATCH", path: "/api/messages/:id", params: IdParams, body: EditMessage, response: Message, idempotent: true }),
  deleteMessage: defineRoute({ method: "DELETE", path: "/api/messages/:id", params: DeleteMessage, response: Message, idempotent: true }),
  reactToMessage: defineRoute({ method: "POST", path: "/api/messages/:id/reactions", params: IdParams, body: ReactToMessage, response: MessageReactions, idempotent: true }),
  reportMessage: defineRoute({ method: "POST", path: "/api/messages/:id/report", params: IdParams, body: ReportMessage, response: Success, idempotent: false }),
  markChannelRead: defineRoute({ method: "POST", path: "/api/channels/:id/read", params: IdParams, body: MarkChannelRead, response: ChannelRead, idempotent: true }),
  listModerationQueue: defineRoute({ method: "GET", path: "/api/moderation/queue", query: ModerationQueueQuery, response: ModerationQueue, idempotent: true }),
  moderateMessage: defineRoute({ method: "POST", path: "/api/moderation/:messageId", params: ModerationParams, body: ModerationAction, response: Message, idempotent: false }),
  askTembo: defineRoute({ method: "POST", path: "/api/channels/:id/tembo", params: IdParams, body: TemboAsk, response: TemboResponse, idempotent: true }),
  temboFeedback: defineRoute({ method: "POST", path: "/api/messages/:id/tembo-feedback", params: IdParams, body: TemboFeedback, response: Success, idempotent: true }),
  listMentors: defineRoute({ method: "GET", path: "/api/mentors", query: MentorDirectoryQuery, response: MentorDirectory, idempotent: true }),
  createMentorRequest: defineRoute({ method: "POST", path: "/api/mentor-requests", body: CreateMentorRequest, response: MentorRequest, idempotent: false }),
  acceptMentorRequest: defineRoute({ method: "POST", path: "/api/mentor-requests/:id/accept", params: IdParams, body: AcceptMentorRequest, response: MentorRequest, idempotent: false }),
  redirectMentorRequest: defineRoute({ method: "POST", path: "/api/mentor-requests/:id/redirect", params: IdParams, body: RedirectMentorRequest, response: MentorRequest, idempotent: false }),
  declineMentorRequest: defineRoute({ method: "POST", path: "/api/mentor-requests/:id/decline", params: IdParams, body: DeclineMentorRequest, response: MentorRequest, idempotent: false }),
  withdrawMentorRequest: defineRoute({ method: "POST", path: "/api/mentor-requests/:id/withdraw", params: IdParams, body: WithdrawMentorRequest, response: MentorRequest, idempotent: false }),
  getMentorAvailability: defineRoute({ method: "GET", path: "/api/mentoring/availability", response: MentorAvailability, idempotent: true }),
  updateMentorAvailability: defineRoute({ method: "PUT", path: "/api/mentoring/availability", body: UpdateMentorAvailability, response: MentorAvailability, idempotent: true }),
  getFlags: defineRoute({ method: "GET", path: "/api/admin/platform-flags", response: FlagsAdmin, idempotent: true }),
  updateFlag: defineRoute({ method: "PUT", path: "/api/admin/platform-flags/:key", params: FlagParams, body: UpdateFlag, response: Flag, idempotent: true }),
  // Onboarding: same-origin browser sessions only; PATs and agent sessions are refused, admin routes included.
  // Every requester write returns the whole OnboardingState, because a withdraw also removes its intent.
  getOnboarding: defineRoute({ method: "GET", path: "/api/platform/onboarding", response: OnboardingState, idempotent: true }),
  updateOnboarding: defineRoute({ method: "PUT", path: "/api/platform/onboarding", body: UpdateOnboarding, response: OnboardingState, idempotent: true }),
  createAccessRequest: defineRoute({ method: "POST", path: "/api/platform/access-requests", body: CreateAccessRequest, response: OnboardingState, idempotent: false }),
  withdrawAccessRequest: defineRoute({ method: "POST", path: "/api/platform/access-requests/:id/withdraw", params: IdParams, body: WithdrawAccessRequest, response: OnboardingState, idempotent: false }),
  dismissAccessRequest: defineRoute({ method: "POST", path: "/api/platform/access-requests/:id/dismiss", params: IdParams, body: DismissAccessRequest, response: OnboardingState, idempotent: true }),
  // Not flag-gated, so pending requests are never stranded when onboarding is switched off.
  listAccessRequests: defineRoute({ method: "GET", path: "/api/admin/access-requests", query: AdminAccessRequestQuery, response: AdminAccessRequestList, idempotent: true }),
  decideAccessRequest: defineRoute({ method: "POST", path: "/api/admin/access-requests/:id/decision", params: IdParams, body: AccessDecision, response: AdminAccessRequest, idempotent: false }),
};
