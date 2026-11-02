import { afterEach, describe, expect, it, vi } from "vitest";
import { listAttention } from "@/lib/attention/service";
import { MODERATION_QUEUE_HREF } from "@/lib/attention/channel-producers";
import { capabilitiesFor } from "@/lib/platform/server/capabilities";
import { ErrorEnvelope, Message, MessageList, ModerationQueue, ROUTES } from "@/lib/platform/contracts";
import type { CapabilityCase } from "@/lib/platform/server/capabilities.fixtures";
import type { ChannelOperation } from "../http";
import { channelDatabase, post, VIEWER, type ChannelFixture } from "../test-support";
import { ChannelError } from "../errors";
import { decideModeration, REPORT_LIMIT } from "./actions";
import { FINDING_REASONS, textKey } from "./detectors";
import { countPendingModeration, listModerationQueue, QUEUE_PAGE_SIZE } from "./queue";

vi.mock("@/lib/observability/errors", async (importOriginal) => ({
  ...await importOriginal<typeof import("@/lib/observability/errors")>(),
  recordError: vi.fn(async () => null),
  recordErrorInBackground: vi.fn(),
}));

const fixtures: ChannelFixture[] = [];
afterEach(() => { fixtures.splice(0).forEach(({ database }) => database.close()); vi.restoreAllMocks(); });
function setup(fixture: Partial<CapabilityCase> = {}) {
  const s = channelDatabase(fixture);
  fixtures.push(s);
  s.agree();
  return s;
}
const OTIENO = "synthetic-otieno";
const ACHIENG = "synthetic-achieng";
const FAITH = "synthetic-faith";
const errorOf = (body: unknown) => ErrorEnvelope.parse(body).error;
const DATABASE_FLAGS = { PLATFORM_FLAGS_OVERRIDE: undefined, DEPLOYMENT_ENVIRONMENT: "production" };
/** Gives someone other than the caller a global role. */
function grant(s: ChannelFixture, userId: string, role: "ADMIN" | "MENTOR") {
  s.database.prepare("INSERT OR IGNORE INTO Roles(id,name) VALUES (?,?)").run(role, role);
  s.database.prepare("INSERT INTO UserRoles(id,userId,roleId) SELECT ?,?,id FROM Roles WHERE name=?").run(`${userId}-${role}`, userId, role);
}
const caseOf = (s: ChannelFixture, id: string) => s.database.prepare(
  "SELECT state, source, reportCount, actorId, decision, decidedBy, reviewRequestedAt IS NOT NULL AS review FROM moderation_case WHERE messageId = ?",
).get(id);
const events = (s: ChannelFixture) => s.database.prepare("SELECT action, source, actorId, fromState, toState, reasons FROM moderation_event ORDER BY createdAt, rowid").all();
const hide = (reason = "Harsh, not about the work") => ({ action: "hide" as const, reason });
async function attentionOf(s: ChannelFixture, userId: string) {
  const { items } = await listAttention(s.db, userId, {}, await capabilitiesFor(s.db, { id: userId }));
  return items.map((item) => ({ kind: item.kind, space: item.space, href: item.subject.href, summary: item.summary, actor: item.actor?.id ?? null }));
}

/** Every moderation route with a valid request, as an admin, against Otieno's message in #help. */
function everyRoute(s: ChannelFixture) {
  const theirs = s.message("help", { author: OTIENO, body: "Theirs" });
  const own = s.message("help", { author: VIEWER, body: "Mine", state: "HIDDEN" });
  return [
    ["reportMessage", { id: theirs, body: { reason: "Spam" } }],
    ["moderateMessage", { id: theirs, body: hide() }],
    ["requestModerationReview", { id: own, body: {} }],
    ["listModerationQueue", {}],
  ] as const satisfies readonly (readonly [ChannelOperation, Parameters<ChannelFixture["call"]>[1]])[];
}

describe("moderation routes: gates", () => {
  it("are 404 while channels is off, 404 signed out, 403 for personal access tokens and cross-origin writes", async () => {
    const s = setup({ globalRoles: ["ADMIN"] });
    for (const [operation, options] of everyRoute(s)) {
      s.database.exec("UPDATE feature_flag SET audience = 'OFF' WHERE key = 'channels'");
      const off = await s.call(operation, { ...options, env: DATABASE_FLAGS });
      expect([off.status, errorOf(off.body).code], `${operation}`).toEqual([404, "flag_off"]);
      s.database.exec("UPDATE feature_flag SET audience = 'ALL' WHERE key = 'channels'");
      expect((await s.call(operation, { ...options, user: null })).status, `${operation}`).toBe(404);
      const token = await s.call(operation, { ...options, locals: { personalAccessToken: { id: "pat", scopes: ["admin:read"] } } as never });
      expect([token.status, errorOf(token.body).code], `${operation}`).toEqual([403, "forbidden"]);
      if (ROUTES[operation].method !== "GET") {
        const crossOrigin = await s.call(operation, { ...options, origin: "https://evil.example" });
        expect(errorOf(crossOrigin.body).message, `${operation}`).toBe("Same-origin request required.");
      }
    }
    expect(events(s)).toEqual([]);
  });

  it("answer with the contract's response and refuse what the contract refuses", async () => {
    const s = setup({ globalRoles: ["ADMIN"] });
    const theirs = s.message("help", { author: OTIENO });
    expect((await s.call("reportMessage", { id: theirs, body: { reason: " " } })).status).toBe(400);
    expect((await s.call("moderateMessage", { id: theirs, body: { action: "ban", reason: "x" } })).status).toBe(400);
    expect((await s.call("listModerationQueue", { query: "?state=OPEN" })).status).toBe(400);
    expect((await s.call("listModerationQueue", { query: "?state=PENDING&state=DECIDED" })).status).toBe(400);
    const missing = await s.call("moderateMessage", { id: "0".repeat(32), body: hide() });
    expect([missing.status, errorOf(missing.body)]).toEqual([404, { code: "not_found", message: "Message not found." }]);
  });
});

describe("reports", () => {
  it("record once per person, open the admin case, keep the text and change nothing the author sees", async () => {
    const s = setup();
    const id = s.message("help", { author: OTIENO, body: "Buy my course for 50k" });
    const first = await s.call("reportMessage", { id, body: { reason: "Unrelated promotion" } });
    expect([first.status, first.body]).toEqual([201, { ok: true }]);
    const again = await s.call("reportMessage", { id, body: { reason: "Also spam" } });
    expect([again.status, again.body]).toEqual([200, { ok: true }]);
    expect(events(s)).toEqual([{ action: "FLAG", source: "REPORT", actorId: VIEWER, fromState: "VISIBLE", toState: "VISIBLE", reasons: '["Unrelated promotion"]' }]);
    expect(caseOf(s, id)).toMatchObject({ state: "PENDING", source: "REPORT", reportCount: 1 });
    expect(s.database.prepare("SELECT body, cause FROM channel_message_version WHERE messageId = ?").all(id))
      .toEqual([{ body: "Buy my course for 50k", cause: "REPORT" }]);
    expect((await s.call("reportMessage", { id, user: ACHIENG, body: { reason: "Spam" } })).status).toBe(201);
    expect(caseOf(s, id)).toMatchObject({ reportCount: 2 });
    const [seen] = MessageList.parse((await s.call("listMessages", { id: s.channel("help"), user: OTIENO })).body).items;
    expect(seen?.moderation).toEqual({ state: "VISIBLE", reasons: [] });
  });

  it("refuse your own message, a deleted one, one you cannot see, and too many in a day", async () => {
    const s = setup();
    const own = s.message("help", { author: VIEWER });
    expect(errorOf((await s.call("reportMessage", { id: own, body: { reason: "x" } })).body).code).toBe("forbidden");
    const gone = s.message("help", { author: OTIENO, deleted: true });
    expect((await s.call("reportMessage", { id: gone, body: { reason: "x" } })).status).toBe(409);
    const hidden = s.message("help", { author: OTIENO, state: "HIDDEN" });
    expect((await s.call("reportMessage", { id: hidden, body: { reason: "x" } })).status).toBe(404);
    const otherCohort = s.message("cohort-05", { author: OTIENO });
    expect((await s.call("reportMessage", { id: otherCohort, body: { reason: "x" } })).status).toBe(404);

    const now = 1_800_000_000_000;
    for (let i = 0; i < REPORT_LIMIT.count; i++) {
      const id = s.message("help", { author: OTIENO, body: `Spam ${i}` });
      expect((await s.call("reportMessage", { id, body: { reason: "Spam" }, now: () => now + i })).status).toBe(201);
    }
    const limited = await s.call("reportMessage", { id: s.message("help", { author: OTIENO }), body: { reason: "Spam" }, now: () => now + 100 });
    expect([limited.status, errorOf(limited.body).retryAfterMs]).toEqual([429, REPORT_LIMIT.windowMs - 100]);
  });
});

describe("hiding: who may", () => {
  type Case = { name: string; fixture: Partial<CapabilityCase>; channel: string; status: number; source?: string };
  const cohortMentor = { assignments: [{ programId: "cohort-a", name: "MENTOR" as const }] };
  const CASES: Case[] = [
    { name: "a cohort's TA, in its channel", fixture: { assignments: [{ programId: "cohort-a", name: "TA" }] }, channel: "cohort-04", status: 200, source: "MENTOR" },
    { name: "a cohort's mentor, in its channel", fixture: cohortMentor, channel: "c04-help", status: 200, source: "MENTOR" },
    { name: "a mentor of another cohort", fixture: { assignments: [{ programId: "cohort-b", name: "MENTOR" }] }, channel: "cohort-04", status: 404 },
    { name: "a cohort's mentor, in a community channel", fixture: cohortMentor, channel: "help", status: 403 },
    { name: "a global mentor, in a community channel", fixture: { globalRoles: ["MENTOR"] }, channel: "help", status: 200, source: "MENTOR" },
    { name: "a global mentor, in a cohort they were not invited to", fixture: { globalRoles: ["MENTOR"] }, channel: "cohort-04", status: 404 },
    { name: "a cohort member", fixture: { applications: [{ programId: "cohort-a", status: "APPROVED" }] }, channel: "cohort-04", status: 403 },
    { name: "a community member", fixture: {}, channel: "help", status: 403 },
    { name: "an admin, in a cohort channel", fixture: { globalRoles: ["ADMIN"] }, channel: "cohort-04", status: 200, source: "ADMIN" },
    { name: "an admin, in a community channel", fixture: { globalRoles: ["ADMIN"] }, channel: "introductions", status: 200, source: "ADMIN" },
  ];

  it.each(CASES)("$name: $status", async ({ fixture, channel, status, source }) => {
    const s = setup(fixture);
    const id = s.message(channel, { author: OTIENO, body: "Rude words" });
    const response = await s.call("moderateMessage", { id, body: hide() });
    expect(response.status).toBe(status);
    if (source === undefined) {
      expect(events(s)).toEqual([]);
      return;
    }
    // An admin also learns whether the author asked for a review.
    expect(Message.parse(response.body).moderation).toEqual({
      state: "HIDDEN", reasons: ["Harsh, not about the work"], ...source === "ADMIN" ? { reviewRequested: false } : {},
    });
    expect(events(s)).toEqual([{ action: "HIDE", source, actorId: VIEWER, fromState: "VISIBLE", toState: "HIDDEN", reasons: '["Harsh, not about the work"]' }]);
    expect(s.database.prepare("SELECT hiddenBy FROM channel_message WHERE id = ?").get(id)).toEqual({ hiddenBy: VIEWER });
    expect(caseOf(s, id)).toMatchObject(source === "ADMIN"
      ? { state: "DECIDED", source: "ADMIN_HIDE", decision: "HIDE", decidedBy: VIEWER }
      : { state: "PENDING", source: "MENTOR_HIDE", actorId: VIEWER });
  });

  it("leaves restoring and keeping to admins", async () => {
    const s = setup({ globalRoles: ["MENTOR"] });
    const id = s.message("help", { author: OTIENO, state: "HIDDEN" });
    for (const action of ["restore", "keep"]) {
      const response = await s.call("moderateMessage", { id, body: { action, reason: "Fine" } });
      expect([response.status, errorOf(response.body).message]).toEqual([403, "Only admins can restore or keep a message."]);
    }
  });
});

describe("hiding: what it does", () => {
  it("hides the text from every reader but the author and moderators, in every read", async () => {
    const s = setup({ assignments: [{ programId: "cohort-a", name: "TA" }] });
    const cohort = s.channel("cohort-04");
    const id = s.message("cohort-04", { author: OTIENO, body: "Synthetic harsh words" });
    const before = MessageList.parse((await s.call("listMessages", { id: cohort, user: ACHIENG })).body);
    expect((await s.call("moderateMessage", { id, body: hide() })).status).toBe(200);
    const latest = MessageList.parse((await s.call("listMessages", { id: cohort, user: ACHIENG })).body);
    const since = MessageList.parse((await s.call("listMessages", { id: cohort, user: ACHIENG, query: `?since=${encodeURIComponent(before.sinceCursor)}` })).body);
    expect([latest.items, since.items, since.removedIds]).toEqual([[], [], [id]]);
    expect(JSON.stringify([latest, since])).not.toContain("Synthetic harsh words");
    expect((await s.call("reportMessage", { id, user: ACHIENG, body: { reason: "x" } })).status).toBe(404);
    for (const user of [OTIENO, FAITH, VIEWER]) {
      const [item] = MessageList.parse((await s.call("listMessages", { id: cohort, user })).body).items;
      expect([item?.body, item?.moderation?.state], `${user}`).toEqual(["Synthetic harsh words", "HIDDEN"]);
    }
  });

  it("is final once an admin restored or kept it, until the author edits", async () => {
    const s = setup({ globalRoles: ["MENTOR"] });
    grant(s, ACHIENG, "ADMIN");
    const id = s.message("help", { author: OTIENO, body: "Borderline joke" });
    expect((await s.call("moderateMessage", { id, body: hide() })).status).toBe(200);
    // Hiding again is a no-op.
    expect((await s.call("moderateMessage", { id, body: hide("Again") })).status).toBe(200);
    const restored = await s.call("moderateMessage", { id, user: ACHIENG, body: { action: "restore", reason: "A joke among friends" } });
    expect(Message.parse(restored.body).moderation).toEqual({ state: "VISIBLE", reasons: [] });
    expect(caseOf(s, id)).toMatchObject({ state: "DECIDED", decision: "RESTORE", decidedBy: ACHIENG });
    const refused = await s.call("moderateMessage", { id, body: hide() });
    expect([refused.status, errorOf(refused.body).message]).toEqual([409, "An admin has already reviewed this message."]);
    s.agree(OTIENO);
    expect((await s.call("editMessage", { id, user: OTIENO, body: { body: "Borderline joke, sharper" }, now: () => Date.now() + 1_000 })).status).toBe(200);
    expect((await s.call("moderateMessage", { id, body: hide() })).status).toBe(200);
    expect(caseOf(s, id)).toMatchObject({ state: "PENDING", source: "MENTOR_HIDE" });
    // An admin upholds a moderator's hide, and may hide what a moderator may not.
    const upheld = await s.call("moderateMessage", { id, user: ACHIENG, body: hide("Upheld") });
    expect(Message.parse(upheld.body).moderation?.reasons).toEqual(["Harsh, not about the work", "Upheld"]);
    expect(caseOf(s, id)).toMatchObject({ state: "DECIDED", decision: "HIDE" });
    const deleted = s.message("help", { author: OTIENO, deleted: true });
    expect((await s.call("moderateMessage", { id: deleted, user: ACHIENG, body: hide() })).status).toBe(409);
  });

  it("keeps a message as fine: visible again, its text and findings allowlisted, never flagged again", async () => {
    const s = setup({ globalRoles: ["ADMIN"] });
    s.agree(OTIENO);
    const text = "TTV office line: 0712 345 678";
    const flagged = Message.parse((await s.call("postMessage", { id: s.channel("help"), user: OTIENO, body: post(text) })).body);
    expect(flagged.moderation?.state).toBe("FLAGGED");
    const kept = await s.call("moderateMessage", { id: flagged.id, body: { action: "keep", reason: "The office line, shared on purpose" } });
    expect(Message.parse(kept.body).moderation).toEqual({ state: "VISIBLE", reasons: [] });
    expect(s.database.prepare("SELECT key, messageId, createdBy FROM moderation_allowlist ORDER BY key").all()).toEqual([
      { key: "phone:+254712345678", messageId: flagged.id, createdBy: VIEWER },
      { key: await textKey(text), messageId: flagged.id, createdBy: VIEWER },
    ]);
    const again = Message.parse((await s.call("postMessage", { id: s.channel("introductions"), user: OTIENO, body: post("Call +254712345678") })).body);
    expect(again.moderation).toEqual({ state: "VISIBLE", reasons: [] });
    expect(caseOf(s, flagged.id)).toMatchObject({ state: "DECIDED", decision: "KEEP" });
  });
});

describe("restoring a hidden message", () => {
  it("is the way back: keep is refused, restore makes it visible and allowlists its text and findings", async () => {
    const s = setup({ globalRoles: ["ADMIN"] });
    grant(s, FAITH, "MENTOR");
    s.agree(OTIENO);
    const text = "Ring the TTV desk: 0712 345 678";
    const posted = Message.parse((await s.call("postMessage", { id: s.channel("help"), user: OTIENO, body: post(text) })).body);
    await s.call("moderateMessage", { id: posted.id, user: FAITH, body: hide() });
    const kept = await s.call("moderateMessage", { id: posted.id, body: { action: "keep", reason: "Fine" } });
    expect([kept.status, errorOf(kept.body).message]).toEqual([409, "This message is hidden. Restore it instead."]);
    expect(caseOf(s, posted.id)).toMatchObject({ state: "PENDING", source: "MENTOR_HIDE" });

    const restored = await s.call("moderateMessage", { id: posted.id, body: { action: "restore", reason: "The desk's public line" } });
    expect(Message.parse(restored.body).moderation).toEqual({ state: "VISIBLE", reasons: [] });
    expect(caseOf(s, posted.id)).toMatchObject({ state: "DECIDED", decision: "RESTORE" });
    expect(s.database.prepare("SELECT key FROM moderation_allowlist ORDER BY key").all()).toEqual([
      { key: "phone:+254712345678" }, { key: await textKey(text) },
    ]);
    const again = Message.parse((await s.call("postMessage", { id: s.channel("introductions"), user: OTIENO, body: post("Desk: +254712345678") })).body);
    expect(again.moderation).toEqual({ state: "VISIBLE", reasons: [] });
  });
});

describe("asking for a review", () => {
  it("lets the author of a hidden message ask once, and reopens nothing an admin decided", async () => {
    const s = setup({ globalRoles: ["MENTOR"] });
    grant(s, ACHIENG, "ADMIN");
    const id = s.message("help", { author: OTIENO });
    await s.call("moderateMessage", { id, body: hide() });
    expect((await s.call("requestModerationReview", { id, body: {} })).status).toBe(403);
    const asked = await s.call("requestModerationReview", { id, user: OTIENO, body: { note: "I was quoting the brief." } });
    expect([asked.status, asked.body]).toEqual([201, { ok: true }]);
    expect((await s.call("requestModerationReview", { id, user: OTIENO, body: {} })).status).toBe(200);
    expect(s.database.prepare("SELECT reviewNote FROM moderation_case WHERE messageId = ?").get(id)).toEqual({ reviewNote: "I was quoting the brief." });

    await s.call("moderateMessage", { id, user: ACHIENG, body: hide("Upheld") });
    const final = await s.call("requestModerationReview", { id, user: OTIENO, body: {} });
    expect([final.status, errorOf(final.body).message]).toEqual([409, "An admin has already reviewed this message."]);
    const visible = s.message("help", { author: OTIENO });
    expect(errorOf((await s.call("requestModerationReview", { id: visible, user: OTIENO, body: {} })).body).message).toBe("This message isn't hidden.");
  });
});

describe("reviewRequested", () => {
  it("tells the author and admins, and no other moderator, whether a review is open", async () => {
    const s = setup({ globalRoles: ["MENTOR"] });
    grant(s, ACHIENG, "ADMIN");
    const id = s.message("help", { author: OTIENO });
    await s.call("moderateMessage", { id, body: hide() });
    const seen = async () => Promise.all([OTIENO, ACHIENG, VIEWER].map(async (user) => {
      const { items } = MessageList.parse((await s.call("listMessages", { id: s.channel("help"), user })).body);
      return items.find((item) => item.id === id)?.moderation?.reviewRequested;
    }));
    expect(await seen()).toEqual([false, false, undefined]);
    await s.call("requestModerationReview", { id, user: OTIENO, body: {} });
    expect(await seen()).toEqual([true, true, undefined]);
    // An admin's decision closes the review.
    await s.call("moderateMessage", { id, user: ACHIENG, body: hide("Upheld") });
    expect(await seen()).toEqual([false, false, undefined]);
    // Only on a hidden message.
    await s.call("moderateMessage", { id, user: ACHIENG, body: { action: "restore", reason: "On reflection, fine" } });
    expect(await seen()).toEqual([undefined, undefined, undefined]);
  });
});

describe("page server functions (U-2.4)", () => {
  const viewer = async (s: ChannelFixture, id: string) => ({ user: { id }, capabilities: await capabilitiesFor(s.db, { id }) });
  const refusalOf = (promise: Promise<unknown>) => promise.then(() => null, (error: unknown) => {
    if (!(error instanceof ChannelError)) throw error;
    return [error.status, error.code, error.message];
  });

  it("list, count and decide as the API does, refusing the same things with ChannelError", async () => {
    const s = setup({ globalRoles: ["MENTOR"] });
    grant(s, ACHIENG, "ADMIN");
    const admin = await viewer(s, ACHIENG);
    const context = { db: s.d1, env: { DEPLOYMENT_ENVIRONMENT: undefined, PLATFORM_FLAGS_OVERRIDE: "all" } };
    const id = s.message("help", { author: OTIENO, body: "Harsh words" });
    expect(await countPendingModeration(s.d1)).toBe(0);

    const hidden = await decideModeration(context, await viewer(s, VIEWER), { messageId: id, ...hide() });
    expect(hidden.moderation?.state).toBe("HIDDEN");
    // Without notifyLater, the notices are written before it returns.
    expect((await attentionOf(s, OTIENO)).map((item) => item.kind)).toEqual(["message_hidden"]);
    expect(await countPendingModeration(s.d1)).toBe(1);
    const queue = await listModerationQueue(s.d1, admin, {});
    expect(queue.items.map((item) => [item.id, item.message.body, item.source])).toEqual([[id, "Harsh words", "MENTOR_HIDE"]]);

    expect(await refusalOf(listModerationQueue(s.d1, await viewer(s, VIEWER), {}))).toEqual([403, "forbidden", "Only admins can see the moderation queue."]);
    expect(await refusalOf(listModerationQueue(s.d1, admin, { cursor: "not-a-cursor" })))
      .toEqual([400, "validation", "Invalid moderation queue cursor."]);
    expect(await refusalOf(decideModeration(context, await viewer(s, VIEWER), { messageId: id, action: "restore", reason: "x" })))
      .toEqual([403, "forbidden", "Only admins can restore or keep a message."]);
    expect(await refusalOf(decideModeration(context, admin, { messageId: id, action: "keep", reason: "x" })))
      .toEqual([409, "conflict", "This message is hidden. Restore it instead."]);
    // Someone who cannot see the hidden message gets the same 404 as for one that does not exist.
    for (const messageId of [id, "0".repeat(32)]) {
      expect(await refusalOf(decideModeration(context, await viewer(s, FAITH), { messageId, ...hide() })))
        .toEqual([404, "not_found", "Message not found."]);
    }

    await decideModeration(context, admin, { messageId: id, ...hide("Upheld") });
    expect([await countPendingModeration(s.d1), caseOf(s, id)]).toEqual([0, expect.objectContaining({ state: "DECIDED", decision: "HIDE" })]);
  });

  it("counts open cases outside direct conversations, and none when the count cannot be read", async () => {
    const s = setup({ globalRoles: ["ADMIN"] });
    for (const id of [s.message("help", { author: OTIENO }), s.message("introductions", { author: OTIENO })]) {
      await s.call("reportMessage", { id, body: { reason: "Spam" } });
    }
    s.database.prepare("UPDATE channel SET kind = 'DIRECT' WHERE slug = 'introductions'").run();
    expect(await countPendingModeration(s.d1)).toBe(1);
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    vi.spyOn(s.d1, "prepare").mockImplementation(() => { throw new Error("D1 is down"); });
    expect(await countPendingModeration(s.d1)).toBe(0);
    expect(warn).toHaveBeenCalledWith("The moderation queue count could not be read.");
  });
});

describe("the queue", () => {
  it("is for admins only", async () => {
    for (const fixture of [{}, { globalRoles: ["MENTOR" as const] }, { assignments: [{ programId: "cohort-a", name: "TA" as const }] }]) {
      const s = setup(fixture);
      const response = await s.call("listModerationQueue");
      expect([response.status, errorOf(response.body).code]).toEqual([403, "forbidden"]);
    }
  });

  it("shows each case with its message, channel, evidence, review and decision, newest first, in one statement", async () => {
    const s = setup({ globalRoles: ["ADMIN"] });
    grant(s, FAITH, "MENTOR");
    s.agree(OTIENO);
    const help = s.channel("help");
    const posted = Message.parse((await s.call("postMessage", { id: help, user: OTIENO, body: post("Write to me at otieno@gmail.com"), now: () => 1_000 })).body);
    await s.call("editMessage", { id: posted.id, user: OTIENO, body: { body: "Write to me here instead" }, now: () => 2_000 });
    const reported = s.message("introductions", { author: OTIENO, body: "Buy my course" });
    await s.call("reportMessage", { id: reported, user: ACHIENG, body: { reason: "Spam" }, now: () => 3_000 });
    const hidden = s.message("introductions", { author: OTIENO, body: "Harsh words" });
    await s.call("moderateMessage", { id: hidden, user: FAITH, body: hide(), now: () => 4_000 });
    await s.call("requestModerationReview", { id: hidden, user: OTIENO, body: { note: "Please look again" }, now: () => 5_000 });

    s.database.exec("UPDATE feature_flag SET audience = 'ALL' WHERE key = 'channels'");
    const prepare = vi.spyOn(s.d1, "prepare");
    const response = await s.call("listModerationQueue", { env: DATABASE_FLAGS });
    expect(prepare).toHaveBeenCalledTimes(6);
    const queue = ModerationQueue.parse(response.body);
    expect(queue.items.map((item) => [item.id, item.source, item.reasons, item.reportCount, item.actor?.id ?? null, item.channel.slug])).toEqual([
      [hidden, "MENTOR_HIDE", ["Harsh, not about the work"], 0, FAITH, "introductions"],
      [reported, "REPORT", ["Spam"], 1, null, "introductions"],
      [posted.id, "AI_FLAG", [FINDING_REASONS.email], 0, null, "help"],
    ]);
    const [first, , last] = queue.items;
    expect(first).toMatchObject({ state: "PENDING", review: { requestedAt: 5_000, note: "Please look again" }, decision: null,
      message: { body: "Harsh words", moderation: { state: "HIDDEN" } } });
    expect(last?.evidence).toEqual([{ body: "Write to me at otieno@gmail.com", cause: "FLAG", capturedAt: 1_000 }]);
    expect(last?.message.body).toBe("Write to me here instead");

    await s.call("moderateMessage", { id: reported, body: { action: "restore", reason: "Not spam" }, now: () => 6_000 });
    const decided = ModerationQueue.parse((await s.call("listModerationQueue", { query: "?state=DECIDED" })).body);
    expect(decided.items).toEqual([expect.objectContaining({
      id: reported, state: "DECIDED", decision: { action: "restore", reason: "Not spam", by: expect.objectContaining({ id: VIEWER }), decidedAt: 6_000 },
    })]);
  });

  it("pages with an opaque cursor bound to its state", async () => {
    const s = setup({ globalRoles: ["ADMIN"] });
    const ids = Array.from({ length: QUEUE_PAGE_SIZE + 2 }, (_, i) => s.message("help", { author: OTIENO, body: `Spam ${i}` }));
    // Two reporters, to stay under the daily report limit; pairs of cases share a time, so ties break by id.
    for (const [i, id] of ids.entries()) {
      await s.call("reportMessage", { id, user: i % 2 ? ACHIENG : VIEWER, body: { reason: "Spam" }, now: () => 10_000 + Math.floor(i / 2) });
    }
    const first = ModerationQueue.parse((await s.call("listModerationQueue")).body);
    expect(first.items).toHaveLength(QUEUE_PAGE_SIZE);
    const second = ModerationQueue.parse((await s.call("listModerationQueue", { query: `?cursor=${encodeURIComponent(first.nextCursor!)}` })).body);
    expect([second.items.length, second.nextCursor]).toEqual([2, null]);
    expect([...first.items, ...second.items].map((item) => item.id).toSorted()).toEqual(ids.toSorted());
    const wrongState = await s.call("listModerationQueue", { query: `?state=DECIDED&cursor=${encodeURIComponent(first.nextCursor!)}` });
    expect(wrongState.status).toBe(400);
    expect((await s.call("listModerationQueue", { query: "?cursor=not-a-cursor" })).status).toBe(400);
  });
});

describe("attention", () => {
  it("tells the author their message was hidden, offers review, and drops the notice once it is restored", async () => {
    const s = setup({ globalRoles: ["MENTOR"] });
    grant(s, ACHIENG, "ADMIN");
    const root = s.message("help", { author: ACHIENG });
    const id = s.message("help", { author: OTIENO, parentId: root });
    await s.call("moderateMessage", { id, body: hide() });
    await s.afterResponse();
    expect(await attentionOf(s, OTIENO)).toEqual([{ kind: "message_hidden", space: "community", actor: null,
      href: `/dashboard/community/c/help?thread=${root}`, summary: "A moderator hid your message in #help. You can ask for a review." }]);
    expect(await attentionOf(s, ACHIENG)).toEqual([{ kind: "moderation_pending", space: "admin", actor: null,
      href: MODERATION_QUEUE_HREF, summary: "A moderator hid a message in #help." }]);
    expect(await attentionOf(s, VIEWER)).toEqual([]);

    await s.call("requestModerationReview", { id, user: OTIENO, body: {} });
    await s.afterResponse();
    expect((await attentionOf(s, ACHIENG)).map((item) => item.summary)).toContain("The author of a hidden message in #help asked for a review.");
    await s.call("moderateMessage", { id, user: ACHIENG, body: { action: "restore", reason: "Fine" } });
    await s.afterResponse();
    expect([await attentionOf(s, OTIENO), await attentionOf(s, ACHIENG)]).toEqual([[], []]);
  });

  it("tells admins of a flag, and says an admin's own hide is final", async () => {
    const s = setup({ globalRoles: ["ADMIN"] });
    s.agree(OTIENO);
    await s.call("postMessage", { id: s.channel("help"), user: OTIENO, body: post("Call me: 0712 345 678") });
    await s.afterResponse();
    expect((await attentionOf(s, VIEWER)).map((item) => item.summary)).toEqual(["A message in #help was flagged."]);
    const id = s.message("cohort-04", { author: OTIENO });
    await s.call("moderateMessage", { id, body: hide() });
    await s.afterResponse();
    expect((await attentionOf(s, OTIENO)).map((item) => [item.space, item.summary]))
      .toEqual([["cohort", "A moderator hid your message in #cohort-04."]]);
  });

  it("tells each mentioned person who can read the channel, once, naming the author", async () => {
    const s = setup({ applications: [{ programId: "cohort-a", status: "APPROVED" }] });
    s.database.prepare('INSERT INTO "user"(id,name,email) VALUES (?,?,?)').run("synthetic-brian", "Brian Kiprop", "b@example.test");
    const cohort = s.channel("cohort-04");
    const sent = Message.parse((await s.call("postMessage", { id: cohort, body: post("@Otieno Ouma and @Brian Kiprop, @Faith Njeri: review?") })).body);
    await s.afterResponse();
    const mention = { kind: "mention", space: "cohort", actor: VIEWER, href: "/dashboard/cohort/c/cohort-04", summary: "Mentioned you in #cohort-04." };
    expect(await attentionOf(s, OTIENO)).toEqual([mention]);
    expect(await attentionOf(s, FAITH)).toEqual([mention]);
    // Brian cannot read cohort 04; the author is never told of their own mention.
    expect([await attentionOf(s, "synthetic-brian"), await attentionOf(s, VIEWER)]).toEqual([[], []]);
    // An edit tells nobody twice, and someone newly mentioned once.
    await s.call("editMessage", { id: sent.id, body: { body: "@Otieno Ouma @Achieng Atieno review?" } });
    await s.afterResponse();
    expect([(await attentionOf(s, OTIENO)).length, (await attentionOf(s, ACHIENG)).length]).toEqual([1, 1]);
    // Losing access to the cohort takes the mention away (checked on every read).
    s.database.exec("DELETE FROM programApplication WHERE userId = 'synthetic-otieno'");
    expect(await attentionOf(s, OTIENO)).toEqual([]);
  });

  it("tells nobody of a mention flood, and stops showing a mention once the message is hidden", async () => {
    const s = setup({ globalRoles: ["ADMIN"] });
    await s.call("postMessage", { id: s.channel("help"), body: post("@Otieno Ouma @Achieng Atieno @Faith Njeri @Amina @Brian look") });
    const single = Message.parse((await s.call("postMessage", { id: s.channel("help"), body: post("@Otieno Ouma look") })).body);
    await s.afterResponse();
    expect((await attentionOf(s, OTIENO)).map((item) => item.kind)).toEqual(["mention"]);
    expect(await attentionOf(s, ACHIENG)).toEqual([]);
    await s.call("moderateMessage", { id: single.id, body: hide() });
    expect(await attentionOf(s, OTIENO)).toEqual([]);
  });
});

describe("moderation routes: query budget", () => {
  it("stays within 10 statements per request", async () => {
    const s = setup({ globalRoles: ["ADMIN"] });
    s.database.exec("UPDATE feature_flag SET audience = 'ALL' WHERE key = 'channels'");
    const counted = async (operation: ChannelOperation, options: Parameters<ChannelFixture["call"]>[1]) => {
      const prepare = vi.spyOn(s.d1, "prepare");
      const response = await s.call(operation, { ...options, env: DATABASE_FLAGS });
      const count = prepare.mock.calls.length;
      prepare.mockRestore();
      return [response.status, count];
    };
    const theirs = s.message("help", { author: OTIENO, body: "Call 0712 345 678" });
    expect(await counted("reportMessage", { id: theirs, body: { reason: "Spam" } })).toEqual([201, 8]);
    expect(await counted("moderateMessage", { id: theirs, body: { action: "keep", reason: "Fine" } })).toEqual([200, 10]);
    expect(await counted("moderateMessage", { id: theirs, body: hide() })).toEqual([200, 9]);
    const own = s.message("help", { author: VIEWER, state: "HIDDEN" });
    expect(await counted("requestModerationReview", { id: own, body: {} })).toEqual([201, 7]);
    expect(await counted("listModerationQueue", {})).toEqual([200, 6]);
  });
});
