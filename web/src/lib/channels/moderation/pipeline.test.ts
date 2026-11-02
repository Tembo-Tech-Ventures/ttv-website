import { afterEach, describe, expect, it, vi } from "vitest";
import { recordError } from "@/lib/observability/errors";
import { ErrorEnvelope, Message, MessageList } from "@/lib/platform/contracts";
import { findChannelById } from "../access";
import { loadChannelPage } from "../page";
import { channelDatabase, post, VIEWER, type ChannelFixture } from "../test-support";
import {
  askClef, CHANNEL_CLEF_HIDE_THRESHOLD, CHANNEL_CLEF_QUESTIONS, CHANNEL_CLEF_THRESHOLDS, ClefCheckError, CLEF_REASONS, clefScreen,
} from "./clef";
import { FINDING_REASONS, REPEAT, textKey } from "./detectors";

vi.mock("@/lib/observability/errors", async (importOriginal) => ({
  ...await importOriginal<typeof import("@/lib/observability/errors")>(),
  recordError: vi.fn(async () => null),
  recordErrorInBackground: vi.fn(),
}));

const fixtures: ChannelFixture[] = [];
afterEach(() => { fixtures.splice(0).forEach(({ database }) => database.close()); vi.clearAllMocks(); });
function setup(...args: Parameters<typeof channelDatabase>) {
  const fixture = channelDatabase(...args);
  fixtures.push(fixture);
  fixture.agree();
  return fixture;
}
const cohortMember = { applications: [{ programId: "cohort-a", status: "APPROVED" as const }] };
const errorOf = (body: unknown) => ErrorEnvelope.parse(body).error;
const events = (s: ChannelFixture) => s.database.prepare("SELECT action, source, actorId, fromState, toState, reasons FROM moderation_event ORDER BY createdAt, rowid").all();
const evidence = (s: ChannelFixture, id: string) =>
  s.database.prepare("SELECT body, cause FROM channel_message_version WHERE messageId = ? ORDER BY capturedAt, rowid").all(id);
const allow = (s: ChannelFixture, key: string) =>
  s.database.prepare("INSERT INTO moderation_allowlist(key, createdAt) VALUES (?, 1)").run(key);

/** A Clef response with every question answered (low unless given). */
const answers = (scores: Partial<Record<keyof typeof CHANNEL_CLEF_QUESTIONS, number>> = {}) => ({
  answers: Object.fromEntries(Object.keys(CHANNEL_CLEF_QUESTIONS).map((q) => [q, { type: "noul", noul: scores[q as keyof typeof scores] ?? 0.02 }])),
});
function clef(response: unknown | (() => Promise<unknown>) = answers()) {
  const run = vi.fn(async () => typeof response === "function" ? (response as () => Promise<unknown>)() : response);
  return { run, env: { AI: { run } as unknown as Ai, AI_GATEWAY_NAME: "ttv-gateway" } };
}

describe("detectors in the write path", () => {
  it("flag a post with contact details, keep it visible, and keep its text as evidence", async () => {
    const s = setup();
    const help = s.channel("help");
    const sent = await s.call("postMessage", { id: help, body: post("Call me on 0712 345 678 after class") });
    const message = Message.parse(sent.body);
    expect([sent.status, message.moderation]).toEqual([201, { state: "FLAGGED", reasons: [FINDING_REASONS.phone] }]);
    expect(events(s)).toEqual([{ action: "FLAG", source: "DETECTOR", actorId: null, fromState: "VISIBLE", toState: "FLAGGED",
      reasons: JSON.stringify([FINDING_REASONS.phone]) }]);
    expect(evidence(s, message.id)).toEqual([{ body: "Call me on 0712 345 678 after class", cause: "FLAG" }]);
    const seen = MessageList.parse((await s.call("listMessages", { id: help, user: "synthetic-otieno" })).body).items;
    expect(seen.map((item) => [item.body, item.moderation])).toEqual([["Call me on 0712 345 678 after class", null]]);
  });

  it("flag an edit that adds contact details, keeping the text it replaced", async () => {
    const s = setup();
    const id = Message.parse((await s.call("postMessage", { id: s.channel("help"), body: post("Ask me about the API") })).body).id;
    const edited = Message.parse((await s.call("editMessage", { id, body: { body: "Ask me: wanjiku [at] gmail [dot] com" } })).body);
    expect(edited.moderation).toEqual({ state: "FLAGGED", reasons: [FINDING_REASONS.email] });
    expect(evidence(s, id)).toEqual([{ body: "Ask me about the API", cause: "EDIT" }, { body: "Ask me: wanjiku [at] gmail [dot] com", cause: "FLAG" }]);
  });

  it("skip what an admin allowlisted: a kept number, or a kept text in any spelling", async () => {
    const s = setup();
    const help = s.channel("help");
    allow(s, "phone:+254712345678");
    const send = async (body: string) => Message.parse((await s.call("postMessage", { id: help, body: post(body) })).body).moderation;
    expect(await send("Office line: +254 712 345 678")).toEqual({ state: "VISIBLE", reasons: [] });
    expect(await send("Office 0712 345 678 or mine 0733 222 444")).toEqual({ state: "FLAGGED", reasons: [FINDING_REASONS.phone] });

    const kept = "@Amina @Brian @Collins @David @Esther: write to info at gmail dot com";
    allow(s, await textKey(kept));
    expect(await send(kept.toUpperCase().replaceAll(" ", "  "))).toEqual({ state: "VISIBLE", reasons: [] });
    const id = Message.parse((await s.call("postMessage", { id: help, body: post("Draft") })).body).id;
    const edited = Message.parse((await s.call("editMessage", { id, body: { body: kept } })).body);
    expect(edited.moderation).toEqual({ state: "VISIBLE", reasons: [] });
    expect(events(s)).toHaveLength(1);
  });

  it("flag the same text in a third channel within the hour, and nothing shorter, older, deleted or kept", async () => {
    const s = setup();
    const start = 1_800_000_000_000;
    let now = start;
    const text = "Selling cheap hosting, DM me for details";
    const send = async (slug: string, body = text) =>
      Message.parse((await s.call("postMessage", { id: s.channel(slug), body: post(body), now: () => now })).body);
    expect((await send("help")).moderation?.state).toBe("VISIBLE");
    expect((await send("help")).moderation?.state).toBe("VISIBLE");
    expect((await send("introductions")).moderation?.state).toBe("VISIBLE");
    const third = await send("show-your-work");
    expect(third.moderation).toEqual({ state: "FLAGGED", reasons: [FINDING_REASONS.repeat] });
    expect(events(s)).toEqual([expect.objectContaining({ source: "DETECTOR", reasons: JSON.stringify([FINDING_REASONS.repeat]) })]);

    // Short texts are ordinary everywhere.
    const short = "Thanks, everyone!";
    expect([...short].length).toBeLessThan(REPEAT.minLength);
    for (const slug of ["help", "introductions", "opportunities"]) expect((await send(slug, short)).moderation?.state).toBe("VISIBLE");
    // Copies older than the window, or deleted, do not count.
    now = start + REPEAT.windowMs;
    expect((await send("design-crit")).moderation?.state).toBe("VISIBLE");
    const other = "Join my study group on Saturday please";
    const copy = await send("help", other);
    await send("introductions", other);
    expect((await s.call("deleteMessage", { id: copy.id })).status).toBe(200);
    expect((await send("opportunities", other)).moderation?.state).toBe("VISIBLE");
    allow(s, await textKey(text));
    expect((await send("opportunities")).moderation?.state).toBe("VISIBLE");
  });

  it("flag mention floods", async () => {
    const s = setup();
    const sent = Message.parse((await s.call("postMessage", { id: s.channel("help"), body: post("@Amina @Brian @Collins @David @Esther standup now") })).body);
    expect(sent.moderation).toEqual({ state: "FLAGGED", reasons: [FINDING_REASONS.mentions] });
  });
});

describe("askClef", () => {
  it("flags each question at its threshold and hides only near-certain abuse", async () => {
    const verdict = async (scores: Parameters<typeof answers>[0]) => askClef(clef(answers(scores)).env.AI, "gw", { body: "x", channelKind: "COMMUNITY" });
    expect(await verdict({})).toEqual({ hide: false, reasons: [] });
    expect(await verdict({ contact_details: CHANNEL_CLEF_THRESHOLDS.contact_details - 0.01 })).toEqual({ hide: false, reasons: [] });
    expect(await verdict({ contact_details: CHANNEL_CLEF_THRESHOLDS.contact_details, unrelated_promotion: 0.99 }))
      .toEqual({ hide: false, reasons: [CLEF_REASONS.contact_details, CLEF_REASONS.unrelated_promotion] });
    expect(await verdict({ abusive: CHANNEL_CLEF_THRESHOLDS.abusive })).toEqual({ hide: false, reasons: [CLEF_REASONS.abusive] });
    expect(await verdict({ abusive: CHANNEL_CLEF_HIDE_THRESHOLD })).toEqual({ hide: true, reasons: [CLEF_REASONS.abusive] });
    // Contact details are never a reason to hide (owner decision 2).
    expect(await verdict({ contact_details: 1, unrelated_promotion: 1 })).toMatchObject({ hide: false });
  });

  it("fails with a reason and never a partial verdict", async () => {
    const failure = (promise: Promise<unknown>) => promise.then(() => null, (error: unknown) => (error as ClefCheckError).failure);
    const message = { body: "x", channelKind: "COHORT" as const };
    expect(await failure(askClef(undefined, "gw", message))).toBe("not_configured");
    expect(await failure(askClef(clef().env.AI, " ", message))).toBe("not_configured");
    expect(await failure(askClef(clef(() => Promise.reject(new Error("upstream 500"))).env.AI, "gw", message))).toBe("model_error");
    expect(await failure(askClef(clef(() => new Promise(() => {})).env.AI, "gw", message, 5))).toBe("timeout");
    expect(await failure(askClef(clef({}).env.AI, "gw", message))).toBe("invalid_response");
    expect(await failure(askClef(clef({ answers: { ...answers().answers, abusive: { type: "noul", noul: 1.5 } } }).env.AI, "gw", message))).toBe("invalid_response");
  });
});

describe("Clef after the response", () => {
  it("checks each new post and changed edit after the response, through the Gateway without logs", async () => {
    const s = setup();
    const { run, env } = clef();
    const help = s.channel("help");
    const body = post("How do I paginate a D1 query?");
    const sent = await s.call("postMessage", { id: help, body, env });
    expect([sent.status, run.mock.calls.length, s.deferred.length]).toEqual([201, 0, 1]);
    await s.afterResponse();
    expect(run).toHaveBeenCalledExactlyOnceWith("@cf/cloudflare/clef-flash", {
      model: "clef-flash", state: { message: body.body, where: "an open community chat channel" }, questions: CHANNEL_CLEF_QUESTIONS,
    }, { gateway: { id: "ttv-gateway", collectLog: false } });

    // A repeated post and an unchanged edit wrote nothing new; a changed edit did.
    const id = Message.parse(sent.body).id;
    expect((await s.call("postMessage", { id: help, body, env })).status).toBe(200);
    expect((await s.call("editMessage", { id, body: { body: body.body }, env })).status).toBe(200);
    expect(s.deferred).toHaveLength(0);
    expect((await s.call("editMessage", { id, body: { body: "How do I paginate with a cursor?" }, env })).status).toBe(200);
    await s.afterResponse();
    expect(run).toHaveBeenCalledTimes(2);
  });

  it("never asks about a refused post or edit: permission, code of conduct or rate limit", async () => {
    const s = setup();
    const { run, env } = clef();
    const own = s.message("help", { author: VIEWER, body: "Mine" });
    // No posting right in announcements.
    expect((await s.call("postMessage", { id: s.channel("c04-announcements"), body: post(), env })).status).toBe(404);
    s.database.exec("UPDATE channel SET postingPolicy = 'STAFF' WHERE slug = 'opportunities'");
    expect((await s.call("postMessage", { id: s.channel("opportunities"), body: post("Hire me please, I build APIs"), env })).status).toBe(403);
    // A new code of conduct version.
    const newer = { conductVersion: 99, env };
    expect(errorOf((await s.call("postMessage", { id: s.channel("help"), body: post("Hello again everyone here"), ...newer })).body).code).toBe("conduct_required");
    expect(errorOf((await s.call("editMessage", { id: own, body: { body: "Changed" }, ...newer })).body).code).toBe("conduct_required");
    // Rate limits.
    const now = 1_800_000_000_000;
    for (let i = 0; i < 10; i++) await s.call("postMessage", { id: s.channel("design-crit"), body: post(`Critique ${i}`), now: () => now, env });
    s.deferred.splice(0);
    expect((await s.call("postMessage", { id: s.channel("design-crit"), body: post("One more"), now: () => now, env })).status).toBe(429);
    expect([s.deferred.length, run.mock.calls.length]).toEqual([0, 0]);
  });

  it("flags what Clef finds, and the message stays visible to everyone", async () => {
    const s = setup();
    const { env } = clef(answers({ contact_details: 0.97, unrelated_promotion: 0.7 }));
    const help = s.channel("help");
    const id = Message.parse((await s.call("postMessage", { id: help, body: post("Ping me on the green app, same name"), env })).body).id;
    await s.afterResponse();
    const reasons = [CLEF_REASONS.contact_details, CLEF_REASONS.unrelated_promotion];
    expect(events(s)).toEqual([{ action: "FLAG", source: "CLEF", actorId: null, fromState: "VISIBLE", toState: "FLAGGED", reasons: JSON.stringify(reasons) }]);
    const mine = MessageList.parse((await s.call("listMessages", { id: help })).body).items[0];
    expect(mine?.moderation).toEqual({ state: "FLAGGED", reasons });
    const theirs = MessageList.parse((await s.call("listMessages", { id: help, user: "synthetic-otieno" })).body).items;
    expect(theirs.map((item) => [item.id, item.body, item.moderation])).toEqual([[id, "Ping me on the green app, same name", null]]);
    expect(evidence(s, id)).toEqual([{ body: "Ping me on the green app, same name", cause: "FLAG" }]);
    expect(s.database.prepare("SELECT state, source FROM moderation_case WHERE messageId = ?").get(id)).toEqual({ state: "PENDING", source: "AI_FLAG" });
  });

  it("hides near-certain abuse from everyone but its author and the channel's moderators, in every read", async () => {
    const s = setup(cohortMember);
    const { env } = clef(answers({ abusive: 0.98 }));
    const cohort = s.channel("cohort-04");
    const reader = (user: string) => ({ id: cohort, user });
    const id = Message.parse((await s.call("postMessage", { id: cohort, body: post("Synthetic abusive text"), env })).body).id;
    // Cached by another reader before Clef answers.
    const before = MessageList.parse((await s.call("listMessages", reader("synthetic-otieno"))).body);
    expect(before.items.map((m) => m.id)).toEqual([id]);
    await s.afterResponse();
    expect(s.database.prepare("SELECT moderationState, hiddenBy, hiddenAt IS NOT NULL AS hidden FROM channel_message WHERE id = ?").get(id))
      .toEqual({ moderationState: "HIDDEN", hiddenBy: null, hidden: 1 });

    // An ordinary reader: gone from the latest page, removed by the next poll, absent from the page frontmatter.
    expect(MessageList.parse((await s.call("listMessages", reader("synthetic-otieno"))).body).items).toEqual([]);
    const since = MessageList.parse((await s.call("listMessages", { ...reader("synthetic-otieno"), query: `?since=${encodeURIComponent(before.sinceCursor)}` })).body);
    expect([since.items, since.removedIds]).toEqual([[], [id]]);
    const channel = await findChannelById(s.db, { id: "synthetic-otieno" }, cohort);
    const page = await loadChannelPage(s.db, s.d1, "synthetic-otieno", channel!, { thread: id });
    expect([page.initial.items, page.thread]).toEqual([[], null]);
    expect(JSON.stringify(page)).not.toContain("Synthetic abusive text");
    expect((await s.call("reactToMessage", { id, user: "synthetic-otieno", body: { kind: "useful", active: true } })).status).toBe(404);

    // The author and the cohort's TA still see it, with why; only the author learns whether a review is open.
    for (const [user, review] of [[VIEWER, { reviewRequested: false }], ["synthetic-faith", {}]] as const) {
      const [item] = MessageList.parse((await s.call("listMessages", reader(user))).body).items;
      expect([item?.body, item?.moderation], `${user}`)
        .toEqual(["Synthetic abusive text", { state: "HIDDEN", reasons: [CLEF_REASONS.abusive], ...review }]);
    }
  });

  it("fails open: errors, timeouts and bad answers leave the message as it was, and are logged without its text", async () => {
    const failing = [
      ["model_error", clef(() => Promise.reject(new Error("upstream 500"))).env],
      ["timeout", clef(() => new Promise(() => {})).env],
      ["invalid_response", clef({ answers: {} }).env],
      ["not_configured", { AI: undefined, AI_GATEWAY_NAME: undefined }],
    ] as const;
    for (const [failure, env] of failing) {
      vi.mocked(recordError).mockClear();
      const s = setup();
      const sent = await s.call("postMessage", { id: s.channel("help"), body: post("Rude words maybe"), env, clefTimeoutMs: 5 });
      expect(sent.status, `${failure}`).toBe(201);
      await s.afterResponse();
      expect(s.database.prepare("SELECT moderationState FROM channel_message").all(), `${failure}`).toEqual([{ moderationState: "VISIBLE" }]);
      expect(events(s), `${failure}`).toEqual([]);
      expect(recordError).toHaveBeenCalledExactlyOnceWith(s.d1, expect.objectContaining({
        source: "request", route: "/api/channels/:id/messages", level: "warning", error: expect.objectContaining({ failure }),
      }));
      const [, input] = vi.mocked(recordError).mock.calls[0]!;
      expect(String((input.error as Error).message)).not.toContain("Rude");
    }
  });

  it("logs an unexpected failure as an error, without its details", async () => {
    const s = setup();
    const { env } = clef(answers({ contact_details: 0.99 }));
    await s.call("postMessage", { id: s.channel("help"), body: post("Text me later on"), env });
    vi.spyOn(s.d1, "batch").mockRejectedValueOnce(new Error("D1 overloaded: synthetic secret"));
    await s.afterResponse();
    expect(recordError).toHaveBeenCalledExactlyOnceWith(s.d1, expect.objectContaining({
      level: "error", error: new Error("Channel message check could not be applied."),
    }));
  });
});

describe("clefScreen", () => {
  const screened = async (s: ChannelFixture, body: string) => {
    const id = Message.parse((await s.call("postMessage", { id: s.channel("help"), body: post(body) })).body).id;
    s.deferred.splice(0);
    return { id, channelId: s.channel("help"), channelKind: "COMMUNITY" as const, body };
  };

  it("does not ask when the text changed, was deleted or hidden, or an admin kept it", async () => {
    const s = setup();
    const { run, env } = clef(answers({ contact_details: 0.99 }));
    const ctx = { db: s.d1, ai: env.AI, gatewayName: env.AI_GATEWAY_NAME };
    const changed = await screened(s, "First words here");
    await s.call("editMessage", { id: changed.id, body: { body: "Second words" } });
    const deleted = await screened(s, "Gone soon");
    await s.call("deleteMessage", { id: deleted.id });
    const hidden = await screened(s, "Hidden soon");
    s.database.prepare("UPDATE channel_message SET moderationState = 'HIDDEN', moderationReasons = '[\"x\"]', hiddenAt = 1 WHERE id = ?").run(hidden.id);
    const kept = await screened(s, "Kept words");
    allow(s, await textKey("Kept words"));
    for (const message of [changed, deleted, hidden, kept]) expect(await clefScreen(ctx, message)).toBe("skipped");
    expect(run).not.toHaveBeenCalled();
  });

  it("changes nothing for a verdict that came too late or adds nothing, and costs one read and one batch", async () => {
    const s = setup();
    const late = await screened(s, "Words before the edit");
    const { env } = clef(async () => {
      s.database.prepare("UPDATE channel_message SET body = 'Edited meanwhile', editedAt = 5 WHERE id = ?").run(late.id);
      return answers({ contact_details: 0.99 });
    });
    expect(await clefScreen({ db: s.d1, ai: env.AI, gatewayName: "gw" }, late)).toBe("unchanged");
    expect(events(s)).toEqual([]);

    const again = await screened(s, "Call me on the green app");
    const flagging = clef(answers({ contact_details: 0.99 })).env;
    const prepare = vi.spyOn(s.d1, "prepare");
    expect(await clefScreen({ db: s.d1, ai: flagging.AI, gatewayName: "gw" }, again)).toBe("flagged");
    expect(prepare).toHaveBeenCalledTimes(3);
    const changeSeq = () => s.database.prepare("SELECT changeSeq FROM channel_message WHERE id = ?").get(again.id);
    const seq = changeSeq();
    expect(await clefScreen({ db: s.d1, ai: flagging.AI, gatewayName: "gw" }, again)).toBe("unchanged");
    expect([changeSeq(), events(s)]).toEqual([seq, [expect.objectContaining({ source: "CLEF" })]]);
    // A hide still applies to a message that was only flagged.
    const hiding = clef(answers({ abusive: 0.99 })).env;
    expect(await clefScreen({ db: s.d1, ai: hiding.AI, gatewayName: "gw" }, again)).toBe("hidden");
    const clear = await screened(s, "Thanks for the session");
    prepare.mockClear();
    expect(await clefScreen({ db: s.d1, ai: clef().env.AI, gatewayName: "gw" }, clear)).toBe("clear");
    expect(prepare).toHaveBeenCalledOnce();
  });
});
