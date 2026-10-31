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
} satisfies { [K in keyof typeof C.ROUTES]: RouteExample<(typeof C.ROUTES)[K]> };

describe("route registry", () => {
  it("covers every plan endpoint and only the three agreed additions", () => {
    const actual = Object.values(C.ROUTES).map((r) => `${r.method} ${r.path}`);
    expect(actual.toSorted()).toEqual([...planEndpoints, ...additionalEndpoints].toSorted());
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

  it("fixes the space, flag and reaction vocabulary", () => {
    expect(C.SpaceId.options).toEqual(["cohort", "community", "mentoring", "discover", "admin", "profile"]);
    expect(C.FlagKey.options).toEqual(["spaces", "channels", "tembo_channels", "mentor_requests"]);
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
