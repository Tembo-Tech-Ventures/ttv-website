import { describe, expect, expectTypeOf, it } from "vitest";
import { z } from "zod";
import * as C from "./contracts";
import * as F from "./fixtures";

/** Independent transcription of plan §3, plus the coordinator-approved extras. */
const planEndpoints = [
  "GET /api/platform/me",
  "GET /api/attention", "GET /api/attention/count", "POST /api/attention/read",
  "GET /api/search", "GET /api/channels",
  "GET /api/channels/:id/messages", "POST /api/channels/:id/messages",
  "PATCH /api/messages/:id", "DELETE /api/messages/:id",
  "POST /api/messages/:id/reactions", "POST /api/messages/:id/report", "POST /api/channels/:id/read",
  "GET /api/moderation/queue", "POST /api/moderation/:messageId", "POST /api/channels/:id/tembo",
  "GET /api/mentors", "POST /api/mentor-requests",
  "POST /api/mentor-requests/:id/accept", "POST /api/mentor-requests/:id/redirect",
  "POST /api/mentor-requests/:id/decline", "POST /api/mentor-requests/:id/withdraw",
  "GET /api/mentoring/availability", "PUT /api/mentoring/availability",
];
const additionalEndpoints = [
  "GET /api/admin/platform-flags", "PUT /api/admin/platform-flags/:key", "POST /api/messages/:id/tembo-feedback",
  // B-2.4: what the composer's attach tools offer in one channel.
  "GET /api/channels/:id/shareables",
];
/** Independent transcription of the onboarding SPEC §5 routes. */
const onboardingEndpoints = [
  "GET /api/platform/onboarding", "PUT /api/platform/onboarding", "POST /api/platform/access-requests",
  "POST /api/platform/access-requests/:id/withdraw", "POST /api/platform/access-requests/:id/dismiss",
  "GET /api/admin/access-requests", "POST /api/admin/access-requests/:id/decision",
];
const post: C.PostMessage = {
  body: "Could you review this?", clientNonce: "test-nonce-1", parentId: null,
  embeds: [{ type: "project", journeyId: F.fixtureIds.chamaLedger, version: 3 }],
};
type RouteExample<T> = T extends C.RouteDef<infer P, infer Q, infer B, infer R>
  ? { params?: P; query?: Q; body?: B; response: R } : never;
const channelParams = { id: F.channels.showYourWork.id };
const messageParams = { id: F.messages.projectPost.id };
const requestParams = { id: F.pendingMentorRequest.id };
const createMentorAccess: C.CreateAccessRequest = {
  role: "MENTOR", note: F.accessRequests.mercyMentor.note, link: F.accessRequests.mercyMentor.link,
};
const createInstitutionAccess: C.CreateAccessRequest = {
  role: "INSTITUTION", note: F.accessRequests.josephInstitution.note, organisation: "Mto Labs",
  organisationRole: "Engineering lead", link: "https://example.com/synthetic/mto-labs", scopeAcknowledged: true,
};
const withdrawnMercy: C.OnboardingState = {
  ...F.onboardingByPersona.mercyAkinyi, intents: ["MEMBER"],
  requests: [{ ...F.accessRequests.mercyMentor, status: "WITHDRAWN", updatedAt: F.FIXTURE_NOW }],
};
const declined = F.adminAccessRequests.decided.items[0];
const routeExamples = {
  getMe: { response: F.meByPersona.wanjiku },
  listAttention: { query: { filter: "all" }, response: F.attention },
  countAttention: { response: F.attentionCount },
  markAttentionRead: { body: { ids: [F.attention.items[0].id] }, response: F.attentionCount },
  search: { query: F.searchResults.query, response: F.searchResults },
  listChannels: { response: F.channelList },
  listMessages: { params: channelParams, query: { since: "opaque-1" }, response: F.communityMessages },
  postMessage: { params: channelParams, body: post, response: F.messages.projectPost },
  editMessage: { params: messageParams, body: { body: "Updated markdown" }, response: F.messages.authorReply },
  deleteMessage: { params: messageParams, response: F.messages.deleted },
  reactToMessage: { params: messageParams, body: { kind: "useful", active: true },
    response: { messageId: F.messages.projectPost.id, reactions: F.messages.projectPost.reactions } },
  reportMessage: { params: messageParams, body: { reason: "Unrelated promotion" }, response: { ok: true } },
  listShareables: { params: { id: F.channels.cohort04.id }, query: { q: "retries" },
    response: { projects: [F.projects.chamaLedger, { ...F.projects.fareSplitter, link: null }], clips: [F.sessionClip] } },
  markChannelRead: { params: channelParams, body: { messageId: F.messages.projectPost.id },
    response: { channelId: channelParams.id, lastReadMessageId: F.messages.projectPost.id, unreadCount: 0 } },
  listModerationQueue: { query: { state: "PENDING" }, response: F.moderationQueue },
  moderateMessage: { params: { messageId: F.messages.hidden.id }, body: { action: "hide", reason: "Harsh, not about the work" }, response: F.messages.hidden },
  askTembo: { params: channelParams, body: { messageId: F.messages.communityAsk.id }, response: F.temboPending },
  temboFeedback: { params: { id: F.messages.communityAnswer.id }, body: { feedback: "helpful" }, response: { ok: true } },
  listMentors: { query: { area: "Code review", available: true }, response: F.mentors },
  createMentorRequest: { body: { mentorId: F.people.david.id, note: "Review this callback handler, please.",
    project: { type: "project", journeyId: F.fixtureIds.fareSplitter, version: 4 }, format: "WRITTEN_REVIEW" }, response: F.pendingMentorRequest },
  acceptMentorRequest: { params: requestParams, body: {}, response: F.acceptedMentorRequest },
  redirectMentorRequest: { params: requestParams, body: { mentorId: F.people.joseph.id, note: "Joseph has career review availability." },
    response: { ...F.pendingMentorRequest, status: "REDIRECTED", redirectedTo: F.people.joseph } },
  declineMentorRequest: { params: requestParams, body: { note: "I have no more capacity this month." },
    response: { ...F.pendingMentorRequest, status: "DECLINED" } },
  withdrawMentorRequest: { params: requestParams, body: {}, response: { ...F.pendingMentorRequest, status: "WITHDRAWN" } },
  getMentorAvailability: { response: F.availability },
  updateMentorAvailability: { body: { monthlyCapacity: 3, areas: ["Code review"], bio: "API reviews", paused: false }, response: F.availability },
  getFlags: { response: F.flagsAdmin },
  updateFlag: { params: { key: "spaces" }, body: { audience: "STAFF" },
    response: { key: "spaces", audience: "STAFF", updatedAt: F.FIXTURE_NOW, updatedBy: F.people.amina.id } },
  getOnboarding: { response: F.onboardingByPersona.wairimu },
  updateOnboarding: { body: { intents: ["MEMBER", "MENTOR"] }, response: { ...F.onboardingByPersona.mercyAkinyi, requests: [] } },
  createAccessRequest: { body: createMentorAccess, response: F.onboardingByPersona.mercyAkinyi },
  withdrawAccessRequest: { params: { id: F.accessRequests.mercyMentor.id }, body: {}, response: withdrawnMercy },
  dismissAccessRequest: { params: { id: F.accessRequests.peterMentor.id }, body: {},
    response: { ...F.onboardingByPersona.peter, requests: [{ ...F.accessRequests.peterMentor, seenAt: F.FIXTURE_NOW }] } },
  listAccessRequests: { query: { status: "PENDING" }, response: F.adminAccessRequests.pending },
  decideAccessRequest: { params: { id: declined.id }, body: { decision: "decline", message: "Thanks for offering, Peter. We can't add this right now." },
    response: declined },
} satisfies { [K in keyof typeof C.ROUTES]: RouteExample<(typeof C.ROUTES)[K]> };

describe("route registry", () => {
  it("covers every plan endpoint, the three agreed additions and the onboarding routes, and nothing else", () => {
    const actual = Object.values(C.ROUTES).map((r) => `${r.method} ${r.path}`);
    expect(actual.toSorted()).toEqual([...planEndpoints, ...additionalEndpoints, ...onboardingEndpoints].toSorted());
    expect(new Set(actual).size).toBe(actual.length);
  });

  it.each(Object.keys(C.ROUTES) as (keyof typeof C.ROUTES)[])("validates the complete %s wire exchange", (key) => {
    const route: C.RouteDef = C.ROUTES[key];
    const example: RouteExample<C.RouteDef> = routeExamples[key];
    for (const part of ["params", "query", "body"] as const) {
      if (route[part]) expect(route[part].parse(example[part])).toEqual(example[part]);
      else expect(example[part]).toBeUndefined();
    }
    expect(route.response.parse(example.response)).toEqual(example.response);
    const pathKeys = [...route.path.matchAll(/:([A-Za-z]+)/g)].map((m) => m[1]).toSorted();
    expect(Object.keys((example.params ?? {}) as object).toSorted()).toEqual(pathKeys);
  });

  it("preserves the exact structural RouteDef shape and infers all four types", () => {
    const r = C.defineRoute({ method: "POST", path: "/example/:id", params: C.IdParams,
      query: C.MessageListQuery, body: C.PostMessage, response: C.Message, idempotent: true });
    expectTypeOf(r).toEqualTypeOf<C.RouteDef<C.IdParams, C.MessageListQuery, C.PostMessage, C.Message>>();
    expect(r.body).toBe(C.PostMessage);
    expect(r.response).toBe(C.Message);
  });

  it("marks retry-safe operations explicitly and never retries unspecified effects", () => {
    for (const r of Object.values(C.ROUTES)) if (r.method === "GET" || r.method === "PUT" || r.method === "DELETE") expect(r.idempotent).toBe(true);
    expect(C.ROUTES.postMessage.idempotent).toBe(true);
    expect(C.ROUTES.reactToMessage.idempotent).toBe(true);
    expect(C.ROUTES.askTembo.idempotent).toBe(true);
    expect(C.ROUTES.createMentorRequest.idempotent).toBe(false);
    expect(C.ROUTES.moderateMessage.idempotent).toBe(false);
    expect(C.ROUTES.reportMessage.idempotent).toBe(false);
  });
});

describe("wire invariants", () => {
  it.each(["ttv-fixture-user-student", "legacy:user_123", "r28UuFKu6PFZ3xRViqtOgjuVO3OsVcwC", "x".repeat(255)])(
    "preserves opaque ids across request and response boundaries: %s", (id) => {
      expect(C.Id.parse(id)).toBe(id);
      expect(C.IdParams.parse({ id })).toEqual({ id });
      expect(C.MessageListQuery.parse({ thread: id })).toEqual({ thread: id });
      expect(C.PersonSummary.parse({ ...F.people.wanjiku, id }).id).toBe(id);
      expect(C.Flag.parse({ ...F.flagsAdmin.flags[0], updatedBy: id }).updatedBy).toBe(id);
      expect(C.PostMessage.parse({ ...post, parentId: id }).parentId).toBe(id);
      expect(C.CreateMentorRequest.parse({ ...routeExamples.createMentorRequest.body, mentorId: id }).mentorId).toBe(id);
      expect(C.RedirectMentorRequest.parse({ mentorId: id, note: "Synthetic referral" }).mentorId).toBe(id);
    },
  );

  it("keeps the Mentoring summary additive: Me without it still parses, and a mentor's carries a count", () => {
    expect(C.Me.parse(F.meByPersona.david)).not.toHaveProperty("mentoring");
    const withSummary = { ...F.meByPersona.david, mentoring: { awaitingConfirmation: 4 } };
    expect(C.Me.parse(withSummary)).toEqual(withSummary);
  });

  it("fixes the space, flag and reaction vocabulary", () => {
    expect(C.SpaceId.options).toEqual(["cohort", "community", "mentoring", "discover", "admin", "profile"]);
    expect(C.FlagKey.options).toEqual(["spaces", "channels", "tembo_channels", "mentor_requests", "onboarding"]);
    expect(C.FlagAudience.options).toEqual(["OFF", "STAFF", "ALL"]);
    expect(C.ReactionKind.options).toEqual(["useful", "learned", "thanks", "agree", "congrats"]);
  });

  it("requires the nonce and accepts opaque client-generated UUIDs without transforming markdown", () => {
    const { clientNonce: _clientNonce, ...missingNonce } = post;
    expect(C.PostMessage.safeParse(missingNonce).success).toBe(false);
    const valid = { ...post, clientNonce: "c8de1411-0060-47f4-bdbb-f51a983b8de2", body: "  **Markdown**\n\n```ts\nrun()\n```" };
    expect(C.PostMessage.parse(valid)).toEqual(valid);
  });

  it.each([
    ["empty nonce", C.PostMessage, { ...post, clientNonce: "" }],
    ["empty body", C.PostMessage, { ...post, body: " \n " }],
    ["oversize body", C.PostMessage, { ...post, body: "x".repeat(10_001) }],
    ["forged author", C.PostMessage, { ...post, authorKind: "TEMBO" }],
    ["unknown embed", C.PostMessage, { ...post, embeds: [{ type: "video", recordingId: F.fixtureIds.session09 }] }],
    ["unknown response embed", C.MessageEmbed, { ...F.sessionClip, type: "linkPreview" }],
    ["forged embed summary", C.EmbedRef, { ...post.embeds[0], summary: "I am confirmed" }],
    ["zero revision", C.ProjectEmbedRef, { ...post.embeds[0], version: 0 }],
    ["negative clip start", C.SessionClipEmbedRef, { type: "sessionClip", recordingId: F.fixtureIds.session09, startSeconds: -1, durationSeconds: 30 }],
    ["zero clip duration", C.SessionClipEmbed, { ...F.sessionClip, durationSeconds: 0 }],
    ["clip longer than ten minutes", C.SessionClipEmbedRef, { type: "sessionClip", recordingId: F.fixtureIds.session09, startSeconds: 0, durationSeconds: 601 }],
    ["six embeds", C.PostMessage, { ...post, embeds: Array.from({ length: 6 }, (_, i) => ({ ...post.embeds[0], version: i + 1 })) }],
    ["unavailable work offered to attach", C.MessageEmbed, { type: "unavailable", kind: "project" }],
    ["unavailable embed of an unknown kind", C.MessageEmbedView, { type: "unavailable", kind: "linkPreview" }],
    ["blank shareables query", C.ShareablesQuery, { q: "  " }],
    ["oversize shareables query", C.ShareablesQuery, { q: "x".repeat(201) }],
    ["unknown shareables parameter", C.ShareablesQuery, { q: "retries", programId: F.fixtureIds.cohort04 }],
    ["too many shareable clips", C.ChannelShareables, { projects: [], clips: Array.from({ length: 21 }, () => F.sessionClip) }],
    ["unknown reaction", C.ReactToMessage, { kind: "upvote", active: true }],
    ["implicit reaction toggle", C.ReactToMessage, { kind: "thanks" }],
    ["unknown returned reaction", C.Reaction, { kind: "heart", count: 1, mine: false }],
    ["negative reaction count", C.Reaction, { kind: "thanks", count: -1, mine: false }],
    ["ambiguous cursors", C.MessageListQuery, { before: "older", since: "newer" }],
    ["empty cursor", C.MessageListQuery, { since: "" }],
    ["empty thread id", C.MessageListQuery, { thread: "" }],
    ["returned and removed message", C.MessageList, { ...F.communityMessages, removedIds: [F.messages.projectPost.id] }],
    ["content in removal tombstone", C.MessageList, { ...F.hiddenMessageDelta, removedIds: [F.messages.hidden] }],
    ["empty report", C.ReportMessage, { reason: " " }],
    ["unknown moderation action", C.ModerationAction, { action: "ban", reason: "report" }],
    ["missing moderation reason", C.ModerationAction, { action: "hide" }],
    ["empty attention batch", C.MarkAttentionRead, { ids: [] }],
    ["ambiguous attention read", C.MarkAttentionRead, { ids: [F.attention.items[0].id], through: F.FIXTURE_NOW }],
    ["empty query", C.SearchQuery, { q: " ", scope: "all" }],
    ["unknown search scope", C.SearchQuery, { q: "retry", scope: "staff_notes" }],
    ["missing visibility", C.SearchSessionMoment, { ...F.searchResults.sessionMoments[0], visibility: undefined }],
    ["empty id", C.Id, ""],
    ["oversize id", C.Id, "x".repeat(256)],
    ["numeric id", C.Id, 123],
    ["date object", C.Timestamp, new Date(F.FIXTURE_NOW)],
    ["ISO timestamp", C.Timestamp, "2026-11-03T07:00:00Z"],
    ["fractional timestamp", C.Timestamp, 1.5],
    ["negative timestamp", C.Timestamp, -1],
    ["infinite timestamp", C.Timestamp, Infinity],
    ["negative usage", C.TemboUsage, { used: -1, limit: 10 }],
    ["invalid feedback", C.TemboFeedback, { feedback: "dislike" }],
    ["forged Tembo scope", C.TemboAsk, { messageId: F.messages.cohortAsk.id, scope: "another-cohort" }],
    ["human Tembo answer", C.TemboAnswer, { status: "answer", message: F.messages.cohortAsk, usage: { used: 1, limit: 10 } }],
    ["unthreaded Tembo answer", C.TemboAnswer, { ...F.temboAnswer, message: { ...F.messages.communityAnswer, parentId: null } }],
    ["deleted body", C.Message, { ...F.messages.deleted, body: "Private original" }],
    ["deleted embed", C.Message, { ...F.messages.deleted, embeds: [F.sessionClip] }],
    ["deleted citation", C.Message, { ...F.messages.deleted, citations: F.messages.communityAnswer.citations }],
    ["community program id", C.Channel, { ...F.channels.showYourWork, programId: F.fixtureIds.cohort04 }],
    ["cohort without program", C.Channel, { ...F.channels.cohort04, programId: null }],
    ["conduct version zero", C.ConductAcknowledgement, { ...F.conductAcknowledgements.current, version: 0 }],
    ["fractional conduct version", C.ConductAcknowledgement, { ...F.conductAcknowledgements.current, version: 1.5 }],
    ["conduct agreement without currency", C.ConductAcknowledgement, { version: 1, acknowledgedAt: F.FIXTURE_NOW }],
    ["negative mentor capacity", C.UpdateMentorAvailability, { ...routeExamples.updateMentorAvailability.body, monthlyCapacity: -1 }],
    ["fractional capacity", C.MentorCapacity, { used: 0, limit: 2.5, nextOpeningAt: null }],
    ["unknown request format", C.CreateMentorRequest, { ...routeExamples.createMentorRequest.body, format: "UNLIMITED_CALLS" }],
    ["accepted request without conversation", C.MentorRequest, { ...F.pendingMentorRequest, status: "ACCEPTED" }],
    ["redirect without mentor", C.MentorRequest, { ...F.pendingMentorRequest, status: "REDIRECTED" }],
    ["pending request with conversation", C.MentorRequest, { ...F.pendingMentorRequest, channelId: F.channels.davidConversation.id }],
    ["empty redirect note", C.RedirectMentorRequest, { mentorId: F.people.joseph.id, note: " " }],
    ["unknown flag", C.FlagParams, { key: "all_users" }],
    ["invalid audience", C.UpdateFlag, { audience: "EVERYONE" }],
    ["missing flag", C.FlagsAdmin, { flags: F.flagsAdmin.flags.slice(1) }],
    ["duplicate flag", C.FlagsAdmin, { flags: F.flagsAdmin.flags.map(() => F.flagsAdmin.flags[0]) }],
    ["missing effective flag", C.EffectiveFlags, { spaces: true }],
    ["wrong space order", C.Me, { ...F.meByPersona.wanjiku, spaces: ["profile", "community"] }],
    ["duplicate space", C.Me, { ...F.meByPersona.lucy, spaces: ["community", "community", "profile"] }],
    ["mentoring summary without the Mentoring space", C.Me, { ...F.meByPersona.wanjiku, mentoring: { awaitingConfirmation: 1 } }],
    ["negative waiting confirmations", C.Me, { ...F.meByPersona.david, mentoring: { awaitingConfirmation: -1 } }],
    // oxlint-disable-next-line no-script-url -- Adversarial input must be rejected by the link contract.
    ["unsafe embed link", C.ProjectEmbed, { ...F.projects.chamaLedger, link: "javascript:alert(1)" }],
    ["protocol-relative link", C.InternalPath, "//example.com"],
    ["backslash link", C.InternalPath, "/\\example.com"],
    ["unknown error code", C.ErrorEnvelope, { error: { code: "oops", message: "Failed" } }],
    ["negative retry delay", C.ErrorEnvelope, { error: { code: "rate_limited", message: "Wait", retryAfterMs: -1 } }],
  ] satisfies [string, z.ZodType, unknown][])("rejects %s", (_label, schema, input) => {
    expect(schema.safeParse(input).success).toBe(false);
  });

  it("permits independent paging directions with a thread, and a snapshot read", () => {
    for (const query of [{}, { before: "opaque-before" }, { since: "opaque-since", thread: F.messages.projectPost.id }]) {
      expect(C.MessageListQuery.parse(query)).toEqual(query);
    }
    expect(C.MarkAttentionRead.parse({ through: F.FIXTURE_NOW })).toEqual({ through: F.FIXTURE_NOW });
  });

  it.each(C.ErrorCode.options)("uses the one error envelope for %s", (code) => {
    const error: C.ErrorEnvelope = { error: { code, message: "Synthetic failure", retryAfterMs: 1000 } };
    expect(C.ErrorEnvelope.parse(error)).toEqual(error);
  });
});

describe("embed contracts (B-2.4)", () => {
  it("lets a message carry a neutral unavailable embed, and strips anything a server might leave on it", () => {
    const leaky = { type: "unavailable", kind: "project", title: "Private draft", journeyId: F.fixtureIds.chamaLedger };
    expect(C.MessageEmbedView.parse(leaky)).toEqual({ type: "unavailable", kind: "project" });
    const message = { ...F.messages.projectPost, embeds: [{ type: "unavailable", kind: "sessionClip" }] };
    expect(C.Message.parse(message).embeds).toEqual([{ type: "unavailable", kind: "sessionClip" }]);
  });

  it("accepts a project without an evidence link, and a clip of exactly ten minutes", () => {
    expect(C.ProjectEmbed.parse({ ...F.projects.chamaLedger, link: null }).link).toBeNull();
    const clip = { type: "sessionClip", recordingId: F.fixtureIds.session09, startSeconds: 0, durationSeconds: C.MAX_CLIP_SECONDS };
    expect(C.SessionClipEmbedRef.parse(clip)).toEqual(clip);
    expect(C.PostMessage.parse({ ...post, embeds: Array.from({ length: 5 }, (_, i) => ({ ...post.embeds[0], version: i + 1 })) }).embeds).toHaveLength(5);
  });

  it("trims the shareables query and allows none", () => {
    expect(C.ShareablesQuery.parse({ q: "  retries " })).toEqual({ q: "retries" });
    expect(C.ShareablesQuery.parse({})).toEqual({});
  });
});

describe("onboarding contracts", () => {
  const mercy = F.accessRequests.mercyMentor;
  const peter = F.accessRequests.peterMentor;
  const decision = { decidedAt: F.FIXTURE_NOW, updatedAt: F.FIXTURE_NOW };

  it("fixes the intent, stage, role, status and decision vocabulary", () => {
    expect(C.Intent.options).toEqual(["MEMBER", "MENTOR", "INSTITUTION", "EXPLORING"]);
    expect(C.InferredIntent.options).toEqual(["MEMBER", "MENTOR", "INSTITUTION"]);
    expect(C.OnboardingStage.options).toEqual(["NEW", "PROMPT", "DONE"]);
    expect(C.AccessRole.options).toEqual(["MENTOR", "INSTITUTION"]);
    expect(C.AccessRequestStatus.options).toEqual(["PENDING", "APPROVED", "DECLINED", "WITHDRAWN"]);
    expect(C.AccessDecisionKind.options).toEqual(["approve", "decline"]);
    expect(C.AttentionKind.options).toEqual(expect.arrayContaining(["access_request", "access_decided"]));
    expect(C.SubjectKind.options).toContain("accessRequest");
  });

  it("adds onboarding to the flag vocabulary, which /me reports like every other key", () => {
    expect(C.FlagKey.options).toContain("onboarding");
    expect(C.EffectiveFlags.safeParse({ spaces: true, channels: true, tembo_channels: true, mentor_requests: true }).success).toBe(false);
  });

  it("refuses retries for writes with effects, and allows them for setting intents and dismissing", () => {
    expect(C.ROUTES.createAccessRequest.idempotent).toBe(false);
    expect(C.ROUTES.withdrawAccessRequest.idempotent).toBe(false);
    expect(C.ROUTES.decideAccessRequest.idempotent).toBe(false);
    expect(C.ROUTES.updateOnboarding.idempotent).toBe(true);
    expect(C.ROUTES.dismissAccessRequest.idempotent).toBe(true);
  });

  it.each<C.UpdateOnboarding>([
    { intents: [] }, { intents: ["EXPLORING"] }, { intents: ["MEMBER"] },
    { intents: ["MEMBER", "MENTOR", "INSTITUTION"] }, { intents: ["INSTITUTION", "MENTOR"] },
  ])("accepts the intent set %j", (body) => {
    expect(C.UpdateOnboarding.parse(body)).toEqual(body);
  });

  it("round-trips both create shapes, with and without optional details", () => {
    for (const body of [createMentorAccess, { ...createMentorAccess, link: null }, createInstitutionAccess,
      { ...createInstitutionAccess, organisationRole: null, link: null }]) {
      expect(C.CreateAccessRequest.parse(JSON.parse(JSON.stringify(body)))).toEqual(body);
    }
    expect(C.UpdateOnboarding.parse({ dismissPrompt: true })).toEqual({ dismissPrompt: true });
    expect(C.AccessDecision.parse({ decision: "approve" })).toEqual({ decision: "approve" });
  });

  it("stores links without the spaces around them", () => {
    expect(C.ExternalLink.parse(" https://example.com/portfolio ")).toBe("https://example.com/portfolio");
  });

  it("measures the note on its content: 20 characters of text, at most 600 in all", () => {
    expect(C.AccessRequestNote.safeParse("x".repeat(20)).success).toBe(true);
    expect(C.AccessRequestNote.safeParse("x".repeat(600)).success).toBe(true);
    expect(C.AccessRequestNote.safeParse(`  ${"x".repeat(19)}  `).success).toBe(false);
  });

  it.each(["ttv-fixture-user-student", "legacy:user_123", "x".repeat(255)])("keeps opaque request ids: %s", (id) => {
    expect(C.AccessRequestSummary.parse({ ...mercy, id }).id).toBe(id);
    expect(C.AdminAccessRequest.parse({ ...declined, id, requester: { ...declined.requester, id } }).requester.id).toBe(id);
  });

  describe("actor-neutral decisions", () => {
    const admin = F.people.amina;
    // Any key a careless serialiser might copy from the row or the admin view.
    const leaked = { ...peter, decidedBy: admin.id, decider: admin, decidedByName: admin.name, githubLogin: "synthetic-amina" };

    it("strips administrator identity from the requester's view, alone and inside OnboardingState", () => {
      const summary = C.AccessRequestSummary.parse(leaked);
      expect(summary).toEqual(peter);
      const state = C.OnboardingState.parse({ ...F.onboardingByPersona.peter, requests: [leaked] });
      for (const text of [JSON.stringify(summary), JSON.stringify(state)]) {
        expect(text).not.toContain(admin.id);
        expect(text).not.toContain(admin.name);
        expect(text).not.toContain("decidedBy");
      }
    });

    it("has no requester-facing field that names an administrator", () => {
      const fields = Object.keys(C.AccessRequestSummary.shape);
      expect(fields.filter((f) => /decided?By|decider|admin|reviewer|actor/i.test(f))).toEqual([]);
      expect(Object.keys(C.OnboardingState.shape).toSorted()).toEqual(["inferred", "intents", "requests", "roles", "stage"]);
      expect(Object.keys(C.AdminAccessRequest.shape)).toContain("decidedBy");
    });

    it("accepts a decision whose deciding account was later deleted", () => {
      expect(C.AdminAccessRequest.parse({ ...declined, decidedBy: null }).decidedBy).toBeNull();
    });
  });

  const decidedItem = F.accessAttention.peter.items[0];
  const requestItem = F.accessAttention.amina.items[0];
  it.each([
    ["exploring with another intent", C.IntentSet, ["EXPLORING", "MEMBER"]],
    ["duplicate intent", C.IntentSet, ["MENTOR", "MENTOR"]],
    ["unknown intent", C.IntentSet, ["EMPLOYER"]],
    ["oversize intent set", C.IntentSet, ["MEMBER", "MENTOR", "INSTITUTION", "EXPLORING", "MEMBER"]],
    ["inferred exploring", C.OnboardingState, { ...F.onboardingByPersona.wairimu, inferred: ["EXPLORING"] }],
    ["duplicate inferred intent", C.OnboardingState, { ...F.onboardingByPersona.wairimu, inferred: ["MEMBER", "MEMBER"] }],
    ["duplicate role", C.OnboardingState, { ...F.onboardingByPersona.wairimu, roles: ["MENTOR", "MENTOR"] }],
    ["unknown stage", C.OnboardingState, { ...F.onboardingByPersona.wairimu, stage: "SKIPPED" }],
    ["two requests for one role", C.OnboardingState, { ...F.onboardingByPersona.peter, requests: [peter, mercy] }],
    ["pending beside the held role", C.OnboardingState, { ...F.onboardingByPersona.mercyAkinyi, roles: ["MENTOR"] }],
    ["update with both shapes", C.UpdateOnboarding, { intents: ["MEMBER"], dismissPrompt: true }],
    ["undoing a dismissal", C.UpdateOnboarding, { dismissPrompt: false }],
    ["self-granted role in update", C.UpdateOnboarding, { intents: ["MENTOR"], roles: ["MENTOR"] }],
    ["unknown access role", C.CreateAccessRequest, { ...createMentorAccess, role: "ADMIN" }],
    ["institution type", C.CreateAccessRequest, { ...createInstitutionAccess, organisationType: "EMPLOYER" }],
    ["short note", C.CreateAccessRequest, { ...createMentorAccess, note: "Happy to help out." }],
    ["oversize note", C.CreateAccessRequest, { ...createMentorAccess, note: "x".repeat(601) }],
    ["mentor with an organisation", C.CreateAccessRequest, { ...createMentorAccess, organisation: "Mto Labs" }],
    ["institution without an organisation", C.CreateAccessRequest, { ...createInstitutionAccess, organisation: undefined }],
    ["blank organisation", C.CreateAccessRequest, { ...createInstitutionAccess, organisation: "  " }],
    ["unacknowledged scope", C.CreateAccessRequest, { ...createInstitutionAccess, scopeAcknowledged: false }],
    ["missing scope acknowledgement", C.CreateAccessRequest, { ...createInstitutionAccess, scopeAcknowledged: undefined }],
    // oxlint-disable-next-line no-script-url -- Adversarial input must be rejected by the link contract.
    ["script link", C.CreateAccessRequest, { ...createMentorAccess, link: "javascript:alert(1)" }],
    ["internal path as link", C.CreateAccessRequest, { ...createMentorAccess, link: "/admin/access-requests" }],
    ["link with a disguising user name", C.ExternalLink, "https://tembotechventures.com@other.example/portfolio"],
    ["link with credentials", C.ExternalLink, "https://user:secret@example.com/"],
    ["link that is not a URL", C.ExternalLink, "portfolio on request"],
    ["forged status", C.CreateAccessRequest, { ...createMentorAccess, status: "APPROVED" }],
    ["pending with a decision time", C.AccessRequestSummary, { ...mercy, ...decision }],
    ["pending with a message", C.AccessRequestSummary, { ...mercy, decisionMessage: "Welcome" }],
    ["declined without a decision time", C.AccessRequestSummary, { ...peter, decidedAt: null }],
    ["withdrawn with a decision time", C.AccessRequestSummary, { ...mercy, status: "WITHDRAWN", ...decision }],
    ["pending marked seen", C.AccessRequestSummary, { ...mercy, seenAt: F.FIXTURE_NOW }],
    ["mentor summary with an organisation", C.AccessRequestSummary, { ...mercy, organisation: "Mto Labs" }],
    ["mentor summary with an organisation role", C.AccessRequestSummary, { ...mercy, organisationRole: "Lead" }],
    ["institution summary without an organisation", C.AccessRequestSummary, { ...F.accessRequests.josephInstitution, organisation: null }],
    ["oversize decision message", C.AccessRequestSummary, { ...peter, decisionMessage: "x".repeat(601) }],
    ["pending with a decider", C.AdminAccessRequest, { ...F.adminAccessRequests.pending.items[1], decidedBy: F.people.amina }],
    ["institution without acknowledgement", C.AdminAccessRequest, { ...F.adminAccessRequests.pending.items[0], scopeAcknowledgedAt: null }],
    ["mentor with acknowledgement", C.AdminAccessRequest, { ...F.adminAccessRequests.pending.items[1], scopeAcknowledgedAt: F.FIXTURE_NOW }],
    ["pending history item", C.AccessRequestHistoryItem, { id: mercy.id, role: "MENTOR", status: "PENDING", decisionMessage: null, createdAt: 0, decidedAt: null }],
    ["unknown queue", C.AdminAccessRequestQuery, { status: "WITHDRAWN" }],
    ["unknown decision", C.AccessDecision, { decision: "defer" }],
    ["empty decision message", C.AccessDecision, { decision: "decline", message: " " }],
    ["oversize decision message", C.AccessDecision, { decision: "decline", message: "x".repeat(601) }],
    ["forged decider", C.AccessDecision, { decision: "approve", decidedBy: F.people.amina.id }],
    ["decision naming an actor", C.AttentionItem, { ...decidedItem, actor: F.people.amina }],
    ["decision outside Community", C.AttentionItem, { ...decidedItem, space: "admin" }],
    ["request outside Admin", C.AttentionItem, { ...requestItem, space: "community" }],
    ["request pointing elsewhere", C.AttentionItem, { ...requestItem, subject: { ...requestItem.subject, kind: "message" } }],
  ] satisfies [string, z.ZodType, unknown][])("rejects %s", (_label, schema, input) => {
    expect(schema.safeParse(input).success).toBe(false);
  });

  it("leaves existing attention kinds free to use any space and actor", () => {
    const item = F.attention.items[0];
    expect(C.AttentionItem.parse({ ...item, space: "admin", subject: { ...item.subject, kind: "accessRequest" } }).space).toBe("admin");
  });
});
