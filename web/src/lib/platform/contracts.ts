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
/**
 * Questions to Tembo in channels today (B-3.1): `used` of `limit`, the day ending at `resetsAt`, the next
 * midnight in Africa/Nairobi (src/lib/tembo/README.md, "Quota").
 */
export const TemboUsage = z.object({ used: Count, limit: Count, resetsAt: Timestamp });
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
  "access_request", "access_decided", "moderation_decided", "mentor_checked",
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
/**
 * A project at one revision. link is the project's own https evidence link, or null when it has
 * none: no TTV page is open to every channel reader (coordinator, seq 382). It is screened with the
 * message, like the title and summary. confirmations are the mentors' latest confirmations at or
 * before this revision, each with the revision it confirmed.
 */
export const ProjectEmbed = z.object({
  type: z.literal("project"), journeyId: Id, version: z.int().positive(), title: NonEmptyText,
  summary: z.string(), skills: z.array(NonEmptyText), link: WebLink.nullable(), confirmations: z.array(ProjectConfirmation),
});
export type ProjectEmbed = z.infer<typeof ProjectEmbed>;
export const SessionClipEmbed = z.object({
  type: z.literal("sessionClip"), recordingId: Id, title: NonEmptyText,
  startSeconds: z.number().nonnegative(), durationSeconds: z.number().positive(), quote: NonEmptyText,
});
export type SessionClipEmbed = z.infer<typeof SessionClipEmbed>;
/** The kinds of work a message can share. */
export const MessageEmbed = z.discriminatedUnion("type", [ProjectEmbed, SessionClipEmbed]);
export type MessageEmbed = z.infer<typeof MessageEmbed>;
/**
 * What a reader gets in place of shared work they can no longer see: a project made private or
 * removed, a recording removed or moved out of the channel's cohort. No title, ids or quotation.
 */
export const UnavailableEmbed = z.object({ type: z.literal("unavailable"), was: z.enum(["project", "sessionClip"]) });
export type UnavailableEmbed = z.infer<typeof UnavailableEmbed>;
/**
 * An embed as one reader sees it, checked again on every read of the message. A change to the work
 * alone does not move the message, so `since` polls do not carry it: an open page shows it when it
 * next reads the message (a fresh latest page, or any change to the message).
 */
export const MessageEmbedView = z.discriminatedUnion("type", [ProjectEmbed, SessionClipEmbed, UnavailableEmbed]);
export type MessageEmbedView = z.infer<typeof MessageEmbedView>;
/** The longest session clip a message can share, in seconds. */
export const MAX_CLIP_SECONDS = 600;
/** Writes send references only; the server resolves labels, quotations and confirmations. */
export const ProjectEmbedRef = z.strictObject({ type: z.literal("project"), journeyId: Id, version: z.int().positive() });
export type ProjectEmbedRef = z.infer<typeof ProjectEmbedRef>;
export const SessionClipEmbedRef = z.strictObject({
  type: z.literal("sessionClip"), recordingId: Id, startSeconds: z.number().nonnegative(),
  durationSeconds: z.number().positive().max(MAX_CLIP_SECONDS),
});
export type SessionClipEmbedRef = z.infer<typeof SessionClipEmbedRef>;
export const EmbedRef = z.discriminatedUnion("type", [ProjectEmbedRef, SessionClipEmbedRef]);
export type EmbedRef = z.infer<typeof EmbedRef>;
export const Citation = z.discriminatedUnion("type", [
  z.object({ type: z.literal("project"), journeyId: Id, version: z.int().positive(), title: NonEmptyText, href: InternalPath }),
  z.object({ type: z.literal("sessionClip"), recordingId: Id, startSeconds: z.number().nonnegative(), title: NonEmptyText, href: InternalPath }),
  z.object({ type: z.literal("message"), messageId: Id, channelId: Id, title: NonEmptyText, href: InternalPath }),
  /** A public builder profile (/talent/<handle>), which Tembo may cite in community channels. */
  z.object({ type: z.literal("profile"), userId: Id, title: NonEmptyText, href: InternalPath }),
]);
export type Citation = z.infer<typeof Citation>;
export const ReactionKind = z.enum(["useful", "learned", "thanks", "agree", "congrats"]);
export type ReactionKind = z.infer<typeof ReactionKind>;
export const Reaction = z.object({ kind: ReactionKind, count: Count, mine: z.boolean() });
export type Reaction = z.infer<typeof Reaction>;
export const ModerationState = z.enum(["VISIBLE", "FLAGGED", "HIDDEN"]);
export type ModerationState = z.infer<typeof ModerationState>;
/**
 * reviewRequested: on a HIDDEN message, for its author and admins only, whether the author's "Ask for
 * review" is still open. reviewable: on a HIDDEN message, for its author only, whether a review can
 * still be asked for or is pending; false once an admin's decision is final, or the message is deleted.
 * Both are absent for everyone else and on any other state. undoable: on a HIDDEN message, for the
 * moderator who hid it only, whether they can still take the hide back (no admin has decided yet, QA2-11).
 */
export const MessageModeration = z.object({
  state: ModerationState, reasons: z.array(NonEmptyText), reviewRequested: z.boolean().optional(), reviewable: z.boolean().optional(),
  undoable: z.boolean().optional(),
});
export type MessageModeration = z.infer<typeof MessageModeration>;
export const ThreadSummary = z.object({ replyCount: Count, participantIds: z.array(Id), lastReplyAt: Timestamp.nullable() });
export type ThreadSummary = z.infer<typeof ThreadSummary>;
export const TemboScope = z.enum(["COHORT", "COMMUNITY", "DIRECT"]);
export type TemboScope = z.infer<typeof TemboScope>;
/**
 * Stands in for each phone number, email address or chat invitation in a FLAGGED message, for every
 * reader except its author, the channel's moderators and admins, until a person decides (QA2-08).
 * Message bodies and search excerpts carry it as plain text; a UI renders it as a note, not as the
 * member's words. Neighbouring details share one marker.
 */
export const MASKED_CONTACT = "[contact details hidden until a moderator checks this message]";
/** Markers in one body at most: the last one covers the rest of the body. */
export const MAX_CONTACT_MASKS = 21;
/** "Helpful" or "not quite" on one of Tembo's answers (POST /api/messages/:id/tembo-feedback). */
export const TemboFeedbackKind = z.enum(["helpful", "not_quite"]);
export type TemboFeedbackKind = z.infer<typeof TemboFeedbackKind>;
export const Message = z.object({
  id: Id, channelId: Id, parentId: Id.nullable(), clientNonce: ClientNonce.nullable(),
  authorKind: AuthorKind, author: AuthorSummary, body: z.string().max(10_000 + MAX_CONTACT_MASKS * MASKED_CONTACT.length),
  embeds: z.array(MessageEmbedView), citations: z.array(Citation), reactions: z.array(Reaction),
  createdAt: Timestamp, edited: z.boolean(), deleted: z.boolean(),
  // Null for ordinary readers. Only authors/moderators receive reasons and state.
  moderation: MessageModeration.nullable(), thread: ThreadSummary, temboScope: TemboScope.nullable(),
  // The caller's own report only: whether they reported this message, never who else did (QA2-06).
  reportedByMe: z.boolean().optional(),
  // On Tembo's answers only: the caller's own choice, null until they make one, never anyone else's.
  temboFeedback: TemboFeedbackKind.nullable().optional(),
  // On the caller's own messages only: whether Tembo was asked about it. A mention refused because the
  // day's questions were used up was never asked, so the note saying so survives a reload (QA3-05).
  temboAsked: z.boolean().optional(),
}).refine((m) => !m.deleted || (m.body === "" && m.embeds.length === 0 && m.citations.length === 0),
  "Deleted messages contain no body, embeds or citations")
  .refine((m) => m.authorKind === "TEMBO" || m.temboFeedback === undefined, "Only Tembo's answers carry the caller's feedback")
  .refine((m) => m.authorKind === "USER" || m.temboAsked === undefined, "Only a person's own messages say whether Tembo was asked")
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
/** q finds session moments by their transcript. */
export const ShareablesQuery = z.strictObject({ q: z.string().trim().min(1).max(200).optional() });
export type ShareablesQuery = z.infer<typeof ShareablesQuery>;
/**
 * What the caller can attach in this channel: their own published projects at the current revision,
 * and session clips only where every reader can see the recording (canShareSessionClip).
 */
export const ChannelShareables = z.object({ projects: z.array(ProjectEmbed).max(50), clips: z.array(SessionClipEmbed).max(20) });
export type ChannelShareables = z.infer<typeof ChannelShareables>;

/**
 * What opened a moderation case (src/lib/channels/README.md, "Moderation"): a detector or Clef flag or
 * hide (AI_FLAG), a member's report, a channel moderator's hide, or an admin's own hide.
 */
export const ModerationSource = z.enum(["AI_FLAG", "REPORT", "MENTOR_HIDE", "ADMIN_HIDE"]);
export type ModerationSource = z.infer<typeof ModerationSource>;
export const ModerationQueueState = z.enum(["PENDING", "DECIDED"]);
export type ModerationQueueState = z.infer<typeof ModerationQueueState>;
export const ModerationActionKind = z.enum(["hide", "restore", "keep"]);
export type ModerationActionKind = z.infer<typeof ModerationActionKind>;
/** Why a text was kept: an author's edit or delete replaced it, or it was flagged, reported or hidden as it was. */
export const MessageVersionCause = z.enum(["EDIT", "DELETE", "FLAG", "REPORT", "HIDE"]);
export type MessageVersionCause = z.infer<typeof MessageVersionCause>;
/** An earlier text of a message, kept as moderation evidence. Admins only. */
export const MessageVersion = z.object({ body: NonEmptyText.max(10_000), cause: MessageVersionCause, capturedAt: Timestamp });
export type MessageVersion = z.infer<typeof MessageVersion>;
/** The author's "Ask for review" of their hidden message. */
export const ModerationReview = z.object({ requestedAt: Timestamp, note: NonEmptyText.max(1000).nullable() });
export type ModerationReview = z.infer<typeof ModerationReview>;
/** An admin's decision; `by` is null once that admin's account is deleted. */
export const ModerationDecision = z.object({
  action: ModerationActionKind, reason: NonEmptyText, by: PersonSummary.nullable(), decidedAt: Timestamp,
});
export type ModerationDecision = z.infer<typeof ModerationDecision>;
/** One case per message (id = the message's id). evidence is oldest first. */
/**
 * createdAt: when the case first opened, the queue's order. reopenedAt: the latest signal that reopened
 * it after an admin's decision; absent for a case never reopened.
 */
export const ModerationQueueItem = z.object({
  id: Id, message: Message, channel: Channel, source: ModerationSource, reasons: z.array(NonEmptyText).min(1),
  state: ModerationQueueState, reportCount: Count, actor: PersonSummary.nullable(), createdAt: Timestamp, reopenedAt: Timestamp.optional(),
  evidence: z.array(MessageVersion), review: ModerationReview.nullable(), decision: ModerationDecision.nullable(),
}).refine((item) => (item.state === "DECIDED") === (item.decision !== null), "Decided exactly when an admin's decision is recorded");
export type ModerationQueueItem = z.infer<typeof ModerationQueueItem>;
export const ModerationQueueQuery = z.strictObject({ cursor: Cursor.optional(), state: ModerationQueueState.optional() });
export type ModerationQueueQuery = z.infer<typeof ModerationQueueQuery>;
export const ModerationQueue = z.object({ items: z.array(ModerationQueueItem), nextCursor: Cursor.nullable() });
export type ModerationQueue = z.infer<typeof ModerationQueue>;
/** Channel moderators may only hide; admins hide, restore or keep ("fine as is", which also allowlists the text). */
export const ModerationAction = z.strictObject({ action: ModerationActionKind, reason: NonEmptyText.max(2000) });
export type ModerationAction = z.infer<typeof ModerationAction>;
/**
 * The channel moderator who hid a message takes the hide back, while its case waits for an admin
 * (QA2-11). An admin's decision is final; admins restore instead. No body.
 */
export const UndoModerationHide = z.strictObject({});
export type UndoModerationHide = z.infer<typeof UndoModerationHide>;
/** The author of a hidden message asks an admin to look again. */
export const RequestModerationReview = z.strictObject({ note: NonEmptyText.max(1000).optional() });
export type RequestModerationReview = z.infer<typeof RequestModerationReview>;
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
export const TemboFeedback = z.strictObject({ feedback: TemboFeedbackKind });
export type TemboFeedback = z.infer<typeof TemboFeedback>;

/**
 * Mentor connections (B-4.1; src/lib/mentoring/README.md). A month is Africa/Nairobi's calendar month.
 * A spot is held by each PENDING request to the mentor and each request they ACCEPTED this month, so
 * used counts both and a full mentor takes no new requests. nextOpeningAt is the next Nairobi month's
 * start when the turn of the month frees a spot (pending requests alone leave room then), else null.
 */
export const MentorCapacity = z.object({ used: Count, limit: Count, nextOpeningAt: Timestamp.nullable() });
export type MentorCapacity = z.infer<typeof MentorCapacity>;
export const MentorRequestFormat = z.enum(["WRITTEN_REVIEW", "CALL_30_MIN", "QUICK_QUESTION"]);
export type MentorRequestFormat = z.infer<typeof MentorRequestFormat>;
/** The formats a mentor offers: at least one, each once. */
export const MentorFormats = z.array(MentorRequestFormat).min(1).max(MentorRequestFormat.options.length)
  .refine((formats) => new Set(formats).size === formats.length, "Each format can be listed once");
export type MentorFormats = z.infer<typeof MentorFormats>;
/** An area a mentor helps with, as they write it ("Code review"). Filters match it ignoring case. */
export const MentorArea = NonEmptyText.max(40);
export type MentorArea = z.infer<typeof MentorArea>;
/**
 * A listed mentor: the MENTOR role, availability saved, not paused, a monthly capacity above zero.
 * Full mentors stay listed with their capacity, so the directory can say when the next opening is.
 * paused is always false here; it is kept for the shape the directory was designed with.
 */
export const MentorDirectoryItem = z.object({
  person: PersonSummary, headline: NonEmptyText, areas: z.array(MentorArea), formats: MentorFormats, bio: z.string(),
  capacity: MentorCapacity, paused: z.boolean(),
});
export type MentorDirectoryItem = z.infer<typeof MentorDirectoryItem>;
/**
 * area: one of the mentor's areas, ignoring case. format: mentors who offer it. available: true lists
 * only mentors with a spot open now; false or absent lists them all. A query string carries it as text.
 */
export const MentorDirectoryQuery = z.strictObject({
  area: MentorArea.optional(), format: MentorRequestFormat.optional(),
  available: z.union([z.boolean(), z.enum(["true", "false"]).transform((value) => value === "true")]).optional(),
});
export type MentorDirectoryQuery = z.infer<typeof MentorDirectoryQuery>;
export const MentorDirectory = z.object({ items: z.array(MentorDirectoryItem) });
export type MentorDirectory = z.infer<typeof MentorDirectory>;
export const MentorRequestStatus = z.enum(["PENDING", "ACCEPTED", "REDIRECTED", "DECLINED", "WITHDRAWN"]);
export type MentorRequestStatus = z.infer<typeof MentorRequestStatus>;
/** What the person asking writes, and what a mentor may write back when they redirect or decline. */
export const MentorRequestNote = NonEmptyText.max(2000);
export type MentorRequestNote = z.infer<typeof MentorRequestNote>;
/** project: the caller's own published project at its current revision, as the channel attach tools offer it. */
export const CreateMentorRequest = z.strictObject({
  mentorId: Id, note: MentorRequestNote, project: ProjectEmbedRef.nullable(), format: MentorRequestFormat,
});
export type CreateMentorRequest = z.infer<typeof CreateMentorRequest>;
/** The attached work as this reader sees it, checked again on every read, like a message's embed. */
export const MentorRequestProject = z.discriminatedUnion("type", [ProjectEmbed, UnavailableEmbed]);
export type MentorRequestProject = z.infer<typeof MentorRequestProject>;
/**
 * A check on the note (src/lib/mentoring/README.md, "Checks"), as this party sees it, never naming who
 * opened it and never "declined". For the person asking, before the mentor saw the request (Clef held
 * it): waiting ("Waiting for a check before it's sent"), then not_sent once an admin removed it ("This
 * request wasn't sent", status WITHDRAWN). After the mentor saw it (they reported it): checking ("TTV
 * is checking this request"), then closed once removed ("This request was closed", status WITHDRAWN).
 * For the mentor: reported (they reported it; they cannot act on it unless an admin keeps it).
 */
export const MentorRequestCheck = z.enum(["waiting", "not_sent", "checking", "closed", "reported"]);
export type MentorRequestCheck = z.infer<typeof MentorRequestCheck>;
/**
 * Seen only by the person asking and the mentor asked. note: the mentor sees contact details in it
 * masked (MASKED_CONTACT), as in a channel. responseNote: what the mentor wrote when redirecting or
 * declining. redirectedTo: null on a redirected request only once the suggested mentor's account is gone.
 * check: null or absent when no check concerns this party; when set, it replaces what status says.
 */
export const MentorRequest = z.object({
  id: Id, requester: PersonSummary, mentor: PersonSummary,
  note: z.string().min(1).max(2000 + MAX_CONTACT_MASKS * MASKED_CONTACT.length),
  project: MentorRequestProject.nullable(), format: MentorRequestFormat, status: MentorRequestStatus,
  channelId: Id.nullable(), redirectedTo: PersonSummary.nullable(), responseNote: MentorRequestNote.nullable(),
  check: MentorRequestCheck.nullable().optional(), createdAt: Timestamp, updatedAt: Timestamp,
}).refine((r) => (r.status === "ACCEPTED") === (r.channelId !== null), "Only accepted requests have a conversation")
  .refine((r) => r.redirectedTo === null || r.status === "REDIRECTED", "Only redirected requests have a target mentor")
  .refine((r) => r.responseNote === null || r.status === "REDIRECTED" || r.status === "DECLINED",
    "Only redirected or declined requests carry the mentor's note");
export type MentorRequest = z.infer<typeof MentorRequest>;
/** as: the requests the caller sent (requester) or received (mentor). Newest first. */
export const MentorRequestListQuery = z.strictObject({
  as: z.enum(["requester", "mentor"]), status: MentorRequestStatus.optional(), cursor: Cursor.optional(),
});
export type MentorRequestListQuery = z.infer<typeof MentorRequestListQuery>;
export const MentorRequestList = z.object({ items: z.array(MentorRequest), nextCursor: Cursor.nullable() });
export type MentorRequestList = z.infer<typeof MentorRequestList>;
/** The mentor reports a waiting request's note; it closes for them and goes to the admins' check. */
export const ReportMentorRequest = z.strictObject({ reason: NonEmptyText.max(2000) });
export type ReportMentorRequest = z.infer<typeof ReportMentorRequest>;
export const MentorRequestCaseState = z.enum(["OPEN", "DECIDED"]);
export type MentorRequestCaseState = z.infer<typeof MentorRequestCaseState>;
/** keep: the request goes (back) to the mentor, PENDING. remove: it closes, never sent. */
export const MentorRequestCaseAction = z.enum(["keep", "remove"]);
export type MentorRequestCaseAction = z.infer<typeof MentorRequestCaseAction>;
/** An admin's decision; `by` is null once that admin's account is deleted. */
export const MentorRequestCaseDecision = z.object({
  action: MentorRequestCaseAction, reason: NonEmptyText, by: PersonSummary.nullable(), decidedAt: Timestamp,
});
export type MentorRequestCaseDecision = z.infer<typeof MentorRequestCaseDecision>;
/**
 * A check on one request (id = the request's id), for admins: the request with its note unmasked,
 * Clef's reasons if Clef held it, the mentor's report if any, and the latest decision. openedAt: when
 * it last opened, the queue's order. A report after a keep opens it again with that decision shown.
 * mentorCapacity: the mentor's spots this Africa/Nairobi month now (null once they have no availability
 * saved), because a keep takes one of them (QA4-10).
 */
export const MentorRequestCase = z.object({
  id: Id, request: MentorRequest, state: MentorRequestCaseState, clefReasons: z.array(NonEmptyText),
  report: z.object({ reason: NonEmptyText, reportedAt: Timestamp }).nullable(), openedAt: Timestamp,
  decision: MentorRequestCaseDecision.nullable(), mentorCapacity: MentorCapacity.nullable(),
}).refine((item) => item.state === "OPEN" || item.decision !== null, "Decided cases carry their decision")
  .refine((item) => item.clefReasons.length > 0 || item.report !== null, "A case is opened by Clef or a report");
export type MentorRequestCase = z.infer<typeof MentorRequestCase>;
/** state: OPEN (the default) or DECIDED. Oldest first. */
export const MentorRequestCaseQuery = z.strictObject({ state: MentorRequestCaseState.optional(), cursor: Cursor.optional() });
export type MentorRequestCaseQuery = z.infer<typeof MentorRequestCaseQuery>;
export const MentorRequestCaseList = z.object({ items: z.array(MentorRequestCase), nextCursor: Cursor.nullable() });
export type MentorRequestCaseList = z.infer<typeof MentorRequestCaseList>;
export const DecideMentorRequestCase = z.strictObject({ action: MentorRequestCaseAction, reason: NonEmptyText.max(2000) });
export type DecideMentorRequestCase = z.infer<typeof DecideMentorRequestCase>;
export const AcceptMentorRequest = z.strictObject({});
export type AcceptMentorRequest = z.infer<typeof AcceptMentorRequest>;
/** Suggest another listed mentor; the person asking decides whether to ask them. */
export const RedirectMentorRequest = z.strictObject({ mentorId: Id, note: MentorRequestNote.optional() });
export type RedirectMentorRequest = z.infer<typeof RedirectMentorRequest>;
/** "Not this month": no note needed, and it counts against nobody. */
export const DeclineMentorRequest = z.strictObject({ note: MentorRequestNote.optional() });
export type DeclineMentorRequest = z.infer<typeof DeclineMentorRequest>;
export const WithdrawMentorRequest = z.strictObject({});
export type WithdrawMentorRequest = z.infer<typeof WithdrawMentorRequest>;
/** The most requests a mentor can take in one month. */
export const MAX_MONTHLY_CAPACITY = 20;
export const UpdateMentorAvailability = z.strictObject({
  headline: NonEmptyText.max(120), monthlyCapacity: Count.max(MAX_MONTHLY_CAPACITY),
  areas: z.array(MentorArea).max(20).refine((areas) => new Set(areas.map((a) => a.trim().toLowerCase())).size === areas.length,
    "Each area can be listed once"),
  formats: MentorFormats, bio: z.string().max(2000), paused: z.boolean(),
});
export type UpdateMentorAvailability = z.infer<typeof UpdateMentorAvailability>;
/**
 * The caller's own availability. Before they first save it: an empty headline, no areas, every format,
 * capacity 0 and listed false. listed: whether the directory shows them now (MentorDirectoryItem).
 */
export const MentorAvailability = UpdateMentorAvailability.extend({
  headline: z.string().max(120), listed: z.boolean(), capacity: MentorCapacity,
});
export type MentorAvailability = z.infer<typeof MentorAvailability>;
/** How many items "Worth another look" lists at once. */
export const WORTH_ANOTHER_LOOK_LIMIT = 20;
/**
 * "Worth another look" (B-4.2): shared work this mentor confirmed at an earlier revision that has a
 * newer revision. confirmedVersion is the latest revision their confirmation covers; currentVersion is
 * newer. href opens the Confirm page, where the current revision waits for them: only work that page
 * shows is listed. Newest change first.
 */
export const WorthAnotherLookItem = z.object({
  journeyId: Id, title: NonEmptyText, owner: PersonSummary, confirmedVersion: z.int().positive(), currentVersion: z.int().positive(),
  href: InternalPath,
}).refine((item) => item.currentVersion > item.confirmedVersion, "Only work with a newer revision than the one confirmed");
export type WorthAnotherLookItem = z.infer<typeof WorthAnotherLookItem>;
export const WorthAnotherLook = z.object({ items: z.array(WorthAnotherLookItem).max(WORTH_ANOTHER_LOOK_LIMIT) });
export type WorthAnotherLook = z.infer<typeof WorthAnotherLook>;
/**
 * A direct conversation's header, for its two members only (server function, no route): the other
 * member (null once their account is gone) and the latest accepted request that opened or continued
 * it, as this member sees it (null for a conversation no request opened).
 */
export const Conversation = z.object({ counterpart: PersonSummary.nullable(), request: MentorRequest.nullable() });
export type Conversation = z.infer<typeof Conversation>;

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
  listShareables: defineRoute({ method: "GET", path: "/api/channels/:id/shareables", params: IdParams, query: ShareablesQuery, response: ChannelShareables, idempotent: true }),
  markChannelRead: defineRoute({ method: "POST", path: "/api/channels/:id/read", params: IdParams, body: MarkChannelRead, response: ChannelRead, idempotent: true }),
  listModerationQueue: defineRoute({ method: "GET", path: "/api/moderation/queue", query: ModerationQueueQuery, response: ModerationQueue, idempotent: true }),
  moderateMessage: defineRoute({ method: "POST", path: "/api/moderation/:messageId", params: ModerationParams, body: ModerationAction, response: Message, idempotent: false }),
  undoModerationHide: defineRoute({ method: "POST", path: "/api/moderation/:messageId/undo", params: ModerationParams, body: UndoModerationHide, response: Message, idempotent: false }),
  requestModerationReview: defineRoute({ method: "POST", path: "/api/messages/:id/review", params: IdParams, body: RequestModerationReview, response: Success, idempotent: true }),
  askTembo: defineRoute({ method: "POST", path: "/api/channels/:id/tembo", params: IdParams, body: TemboAsk, response: TemboResponse, idempotent: true }),
  temboFeedback: defineRoute({ method: "POST", path: "/api/messages/:id/tembo-feedback", params: IdParams, body: TemboFeedback, response: Success, idempotent: true }),
  listMentors: defineRoute({ method: "GET", path: "/api/mentors", query: MentorDirectoryQuery, response: MentorDirectory, idempotent: true }),
  listMentorRequests: defineRoute({ method: "GET", path: "/api/mentor-requests", query: MentorRequestListQuery, response: MentorRequestList, idempotent: true }),
  getMentorRequest: defineRoute({ method: "GET", path: "/api/mentor-requests/:id", params: IdParams, response: MentorRequest, idempotent: true }),
  createMentorRequest: defineRoute({ method: "POST", path: "/api/mentor-requests", body: CreateMentorRequest, response: MentorRequest, idempotent: false }),
  acceptMentorRequest: defineRoute({ method: "POST", path: "/api/mentor-requests/:id/accept", params: IdParams, body: AcceptMentorRequest, response: MentorRequest, idempotent: false }),
  redirectMentorRequest: defineRoute({ method: "POST", path: "/api/mentor-requests/:id/redirect", params: IdParams, body: RedirectMentorRequest, response: MentorRequest, idempotent: false }),
  declineMentorRequest: defineRoute({ method: "POST", path: "/api/mentor-requests/:id/decline", params: IdParams, body: DeclineMentorRequest, response: MentorRequest, idempotent: false }),
  withdrawMentorRequest: defineRoute({ method: "POST", path: "/api/mentor-requests/:id/withdraw", params: IdParams, body: WithdrawMentorRequest, response: MentorRequest, idempotent: false }),
  reportMentorRequest: defineRoute({ method: "POST", path: "/api/mentor-requests/:id/report", params: IdParams, body: ReportMentorRequest, response: MentorRequest, idempotent: false }),
  listMentorRequestCases: defineRoute({ method: "GET", path: "/api/moderation/mentor-requests", query: MentorRequestCaseQuery, response: MentorRequestCaseList, idempotent: true }),
  decideMentorRequestCase: defineRoute({ method: "POST", path: "/api/moderation/mentor-requests/:id", params: IdParams, body: DecideMentorRequestCase, response: MentorRequestCase, idempotent: false }),
  getWorthAnotherLook: defineRoute({ method: "GET", path: "/api/mentoring/another-look", response: WorthAnotherLook, idempotent: true }),
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
