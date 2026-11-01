import { afterEach, describe, expect, it } from "vitest";
import { ChannelList, ChannelRead, ErrorEnvelope, Message, MessageList, MessageReactions } from "@/lib/platform/contracts";
import { CONDUCT_VERSION } from "./conduct";
import { POST_LIMITS } from "./mutations";
import { channelDatabase, post, VIEWER, type ChannelFixture } from "./test-support";

const fixtures: ChannelFixture[] = [];
afterEach(() => { fixtures.splice(0).forEach(({ database }) => database.close()); });
function setup(...args: Parameters<typeof channelDatabase>) {
  const fixture = channelDatabase(...args);
  fixtures.push(fixture);
  return fixture;
}
const cohortMember = { applications: [{ programId: "cohort-a", status: "APPROVED" as const }] };
const errorOf = (body: unknown) => ErrorEnvelope.parse(body).error;
const row = (s: ChannelFixture, id: string) => s.database.prepare("SELECT * FROM channel_message WHERE id = ?").get(id) as Record<string, unknown>;

describe("posting", () => {
  it("creates a root message and a reply, numbering both and moving the root for pollers", async () => {
    const s = setup();
    s.agree();
    const help = s.channel("help");
    const root = await s.call("postMessage", { id: help, body: post("Where do I start with webhooks?") });
    expect(root.status).toBe(201);
    const message = Message.parse(root.body);
    expect(message).toMatchObject({ channelId: help, parentId: null, authorKind: "USER", body: "Where do I start with webhooks?",
      author: { id: VIEWER, name: "Wanjiku Njeri" }, moderation: { state: "VISIBLE", reasons: [] }, deleted: false, edited: false });
    expect(message.clientNonce).not.toBeNull();
    const before = row(s, message.id);
    const reply = Message.parse((await s.call("postMessage", { id: help, body: post("Start with the retries session.", message.id) })).body);
    expect(reply.parentId).toBe(message.id);
    const after = row(s, message.id);
    expect(after.seq).toBe(before.seq);
    expect(Number(after.changeSeq)).toBeGreaterThan(Number(row(s, reply.id).seq));
    const page = MessageList.parse((await s.call("listMessages", { id: help })).body);
    expect(page.items).toHaveLength(1);
    expect(page.items[0]!.thread.replyCount).toBe(1);
  });

  it("is idempotent on the client nonce, including concurrent retries", async () => {
    const s = setup();
    s.agree();
    const help = s.channel("help");
    const body = post("Exactly once, please.");
    const results = await Promise.all(Array.from({ length: 5 }, () => s.call("postMessage", { id: help, body })));
    expect(results.map((r) => r.status).toSorted()).toEqual([200, 200, 200, 200, 201]);
    const ids = new Set(results.map((r) => Message.parse(r.body).id));
    expect(ids.size).toBe(1);
    expect(s.database.prepare("SELECT COUNT(*) AS n FROM channel_message").get()).toEqual({ n: 1 });

    // Other content, another thread or another channel under a used nonce is a conflict.
    const [id] = ids;
    for (const [channel, reuse] of [[help, { ...body, body: "Something else" }], [help, { ...body, parentId: id! }],
      [s.channel("introductions"), body]] as const) {
      const conflict = await s.call("postMessage", { id: channel, body: reuse });
      expect([conflict.status, errorOf(conflict.body).code]).toEqual([409, "conflict"]);
    }
    // The original content is gone after an edit, so a retry then needs only the same place.
    await s.call("editMessage", { id, body: { body: "Exactly once, edited." } });
    const retry = await s.call("postMessage", { id: help, body });
    expect([retry.status, Message.parse(retry.body).body]).toEqual([200, "Exactly once, edited."]);
    expect(s.database.prepare("SELECT COUNT(*) AS n FROM channel_message").get()).toEqual({ n: 1 });
  });

  it("returns the earlier post to a retry even after posting rights end", async () => {
    const s = setup(cohortMember);
    s.agree();
    const cohort = s.channel("cohort-04");
    const body = post("Before the archive.");
    const first = await s.call("postMessage", { id: cohort, body });
    s.database.exec(`UPDATE channel SET archivedAt = 5 WHERE id = '${cohort}'`);
    const retry = await s.call("postMessage", { id: cohort, body });
    expect([retry.status, Message.parse(retry.body).id]).toEqual([200, Message.parse(first.body).id]);
    const fresh = await s.call("postMessage", { id: cohort, body: post("After the archive.") });
    expect([fresh.status, errorOf(fresh.body).code]).toEqual([403, "forbidden"]);
  });

  it("requires the current code of conduct before a first post, and again after a new version", async () => {
    const s = setup();
    const help = s.channel("help");
    const first = await s.call("postMessage", { id: help, body: post() });
    expect([first.status, errorOf(first.body).code]).toEqual([403, "conduct_required"]);
    s.agree();
    expect((await s.call("postMessage", { id: help, body: post() })).status).toBe(201);
    const bumped = await s.call("postMessage", { id: help, body: post(), conductVersion: CONDUCT_VERSION + 1 });
    expect([bumped.status, errorOf(bumped.body).code]).toEqual([403, "conduct_required"]);
    s.agree(VIEWER, CONDUCT_VERSION + 1);
    expect((await s.call("postMessage", { id: help, body: post(), conductVersion: CONDUCT_VERSION + 1 })).status).toBe(201);
    expect(s.database.prepare("SELECT COUNT(*) AS n FROM channel_message").get()).toEqual({ n: 2 });
  });

  it("limits posts per person per channel, then per day, with how long to wait", async () => {
    const s = setup();
    s.agree();
    const [help, intro] = [s.channel("help"), s.channel("introductions")];
    const start = 1_800_000_000_000;
    let now = start;
    const send = (id: string) => s.call("postMessage", { id, body: post(), now: () => now });
    for (let i = 0; i < POST_LIMITS.channel.count; i++) { expect((await send(help)).status).toBe(201); now += 1_000; }
    const limited = await send(help);
    const error = errorOf(limited.body);
    expect([limited.status, error.code]).toEqual([429, "rate_limited"]);
    expect(error.retryAfterMs).toBe(start + POST_LIMITS.channel.windowMs - now);
    expect(limited.response.headers.get("Retry-After")).toBe(String(Math.ceil(error.retryAfterMs! / 1000)));
    // Another channel has its own burst allowance; the window moves on.
    expect((await send(intro)).status).toBe(201);
    now = start + POST_LIMITS.channel.windowMs;
    expect((await send(help)).status).toBe(201);

    // Fill the rest of the day, spread over channels and time so no burst limit applies.
    const posted = Number((s.database.prepare("SELECT COUNT(*) AS n FROM channel_message").get() as { n: number }).n);
    const slugs = ["help", "introductions", "show-your-work", "opportunities", "design-crit"];
    for (let i = posted; i < POST_LIMITS.day.count; i++) {
      now += 7_000;
      expect((await send(s.channel(slugs[i % slugs.length]!))).status, `post ${i}`).toBe(201);
    }
    now += 7_000;
    const daily = await send(s.channel("design-crit"));
    expect([daily.status, errorOf(daily.body).code]).toEqual([429, "rate_limited"]);
    expect(errorOf(daily.body).retryAfterMs).toBe(start + POST_LIMITS.day.windowMs - now);
    // Deleting a message does not give back its place in the day.
    const own = (s.database.prepare("SELECT id FROM channel_message LIMIT 1").get() as { id: string }).id;
    await s.call("deleteMessage", { id: own });
    expect((await send(s.channel("design-crit"))).status).toBe(429);
  });

  it("enforces postingPolicy STAFF: members read announcements, instructors, TAs and admins post", async () => {
    const cases = [
      { fixture: cohortMember, status: 403 },
      { fixture: { assignments: [{ programId: "cohort-a", name: "MENTOR" as const }] }, status: 403 },
      { fixture: { assignments: [{ programId: "cohort-a", name: "TA" as const }] }, status: 201 },
      { fixture: { assignments: [{ programId: "cohort-a", name: "INSTRUCTOR" as const }] }, status: 201 },
      { fixture: { globalRoles: ["ADMIN"] }, status: 201 },
      { fixture: { assignments: [{ programId: "cohort-b", name: "INSTRUCTOR" as const }] }, status: 404 },
    ];
    for (const { fixture, status } of cases) {
      const s = setup(fixture);
      s.agree();
      const announcements = s.channel("c04-announcements");
      const response = await s.call("postMessage", { id: announcements, body: post("Session moved to 18:30.") });
      expect(response.status, `${JSON.stringify(fixture)}`).toBe(status);
      if (status === 403) {
        expect(errorOf(response.body).code).toBe("forbidden");
        expect((await s.call("listMessages", { id: announcements })).status).toBe(200);
      }
    }
  });

  it("rejects a thread parent from another channel, a reply as parent, and closed threads", async () => {
    const s = setup();
    s.agree();
    const help = s.channel("help");
    const elsewhere = s.message("introductions");
    const root = s.message("help");
    const reply = s.message("help", { parentId: root });
    const hidden = s.message("help", { state: "HIDDEN" });
    const ownHidden = s.message("help", { state: "HIDDEN", author: VIEWER });
    const deleted = s.message("help", { deleted: true });
    for (const [parentId, status, code] of [
      [elsewhere, 404, "not_found"], [reply, 404, "not_found"], [hidden, 404, "not_found"], ["message-missing", 404, "not_found"],
      [ownHidden, 409, "conflict"], [deleted, 409, "conflict"],
    ] as const) {
      const response = await s.call("postMessage", { id: help, body: post("Replying", parentId) });
      expect([response.status, errorOf(response.body).code], `${parentId}`).toEqual([status, code]);
    }
    expect(s.database.prepare("SELECT COUNT(*) AS n FROM channel_message WHERE authorId = ?").get(VIEWER)).toEqual({ n: 1 });
    expect((await s.call("postMessage", { id: help, body: post("Replying", root) })).status).toBe(201);
  });

  it("refuses attachments until embeds land", async () => {
    const s = setup();
    s.agree();
    const response = await s.call("postMessage", { id: s.channel("help"),
      body: { ...post(), embeds: [{ type: "project", journeyId: "journey", version: 1 }] } });
    expect([response.status, errorOf(response.body).code]).toEqual([400, "validation"]);
  });

  it("stores what the moderation hook flags, with a detector event, and keeps the message visible", async () => {
    const s = setup();
    s.agree();
    const screen = ({ body }: { body: string }) => ({ reasons: body.includes("07") ? [" Contact details ", "Contact details"] : [] });
    const flagged = Message.parse((await s.call("postMessage", { id: s.channel("opportunities"), body: post("Call me on 0712 000 000"), screen })).body);
    expect(flagged.moderation).toEqual({ state: "FLAGGED", reasons: ["Contact details"] });
    expect(s.database.prepare("SELECT action, source, actorId, fromState, toState, reasons FROM moderation_event").all()).toEqual([
      { action: "FLAG", source: "DETECTOR", actorId: null, fromState: "VISIBLE", toState: "FLAGGED", reasons: '["Contact details"]' },
    ]);
    const others = MessageList.parse((await s.call("listMessages", { id: s.channel("opportunities"), user: "synthetic-otieno" })).body);
    expect(others.items.map((item) => [item.id, item.moderation])).toEqual([[flagged.id, null]]);

    // The edit path runs the same hook, and flags only ever add up.
    const clean = Message.parse((await s.call("postMessage", { id: s.channel("help"), body: post("No contact here"), screen })).body);
    const edited = Message.parse((await s.call("editMessage", { id: clean.id, body: { body: "Now 0712 000 000" }, screen })).body);
    expect(edited.moderation).toEqual({ state: "FLAGGED", reasons: ["Contact details"] });
    const cleaned = Message.parse((await s.call("editMessage", { id: clean.id, body: { body: "Removed it" }, screen })).body);
    expect(cleaned.moderation?.state).toBe("FLAGGED");
    expect(s.database.prepare("SELECT COUNT(*) AS n FROM moderation_event").get()).toEqual({ n: 2 });
  });
});

describe("editing and deleting", () => {
  /** Who may edit and delete a message by `author`, read by the caller with `fixture`. */
  const MATRIX: { name: string; author: typeof VIEWER | "synthetic-otieno" | null; fixture: { globalRoles?: string[] }; edit: number; del: number }[] = [
    { name: "the author", author: VIEWER, fixture: {}, edit: 200, del: 200 },
    { name: "another member", author: "synthetic-otieno", fixture: {}, edit: 403, del: 403 },
    { name: "a community moderator", author: "synthetic-otieno", fixture: { globalRoles: ["MENTOR"] }, edit: 403, del: 403 },
    { name: "an admin", author: "synthetic-otieno", fixture: { globalRoles: ["ADMIN"] }, edit: 403, del: 403 },
    { name: "anyone, for Tembo", author: null, fixture: { globalRoles: ["ADMIN"] }, edit: 403, del: 403 },
  ];

  it.each(MATRIX)("$name: edit $edit, delete $del", async ({ author, fixture, edit, del }) => {
    const s = setup(fixture);
    s.agree();
    const root = s.message("help");
    const id = author === null ? s.message("help", { tembo: true, parentId: root }) : s.message("help", { author, body: "Original" });
    const edited = await s.call("editMessage", { id, body: { body: "Rewritten" } });
    expect(edited.status).toBe(edit);
    if (edit === 403) expect(errorOf(edited.body).code).toBe("forbidden");
    else expect(Message.parse(edited.body)).toMatchObject({ body: "Rewritten", edited: true });
    const deleted = await s.call("deleteMessage", { id });
    expect(deleted.status).toBe(del);
    if (del === 200) {
      expect(Message.parse(deleted.body)).toMatchObject({ id, body: "", deleted: true, edited: false, embeds: [], reactions: [] });
      // Deleting again returns the same placeholder.
      expect(Message.parse((await s.call("deleteMessage", { id })).body).deleted).toBe(true);
    } else {
      expect(row(s, id).deletedAt).toBeNull();
    }
  });

  it("is 404 for a message in a channel the caller cannot read, and for another person's hidden message", async () => {
    const s = setup();
    s.agree();
    const foreign = s.message("cohort-05", { author: "synthetic-otieno" });
    const hidden = s.message("help", { author: "synthetic-otieno", state: "HIDDEN" });
    for (const id of [foreign, hidden, "message-missing"]) {
      for (const [operation, body] of [["editMessage", { body: "x" }], ["deleteMessage", undefined], ["reactToMessage", { kind: "useful", active: true }]] as const) {
        const response = await s.call(operation, { id, body });
        expect([response.status, errorOf(response.body).code], `${operation} ${id}`).toEqual([404, "not_found"]);
      }
    }
  });

  it("keeps deleted and hidden messages as they are, and edits only where the author can still post", async () => {
    const s = setup(cohortMember);
    s.agree();
    const hidden = s.message("help", { author: VIEWER, state: "HIDDEN" });
    const deleted = s.message("help", { author: VIEWER, deleted: true });
    expect((await s.call("editMessage", { id: hidden, body: { body: "x" } })).status).toBe(409);
    expect((await s.call("editMessage", { id: deleted, body: { body: "x" } })).status).toBe(409);
    // The author may still delete their own hidden message.
    expect(Message.parse((await s.call("deleteMessage", { id: hidden })).body)).toMatchObject({ deleted: true, moderation: { state: "HIDDEN" } });

    const archived = s.message("cohort-04", { author: VIEWER, body: "Before" });
    s.database.exec(`UPDATE channel SET archivedAt = 5 WHERE slug = 'cohort-04'`);
    expect((await s.call("editMessage", { id: archived, body: { body: "After" } })).status).toBe(403);
    expect((await s.call("deleteMessage", { id: archived })).status).toBe(200);
  });

  it("asks for the current code of conduct before an edit, and treats the same body as no change", async () => {
    const s = setup();
    const id = s.message("help", { author: VIEWER, body: "Original" });
    const refused = await s.call("editMessage", { id, body: { body: "Rewritten" } });
    expect([refused.status, errorOf(refused.body).code]).toEqual([403, "conduct_required"]);
    s.agree();
    const before = row(s, id);
    expect(Message.parse((await s.call("editMessage", { id, body: { body: "Original" } })).body).edited).toBe(false);
    expect(row(s, id)).toEqual(before);
  });

  it("deleting a reply moves its root for pollers and drops the message's reactions", async () => {
    const s = setup();
    s.agree();
    const root = s.message("help");
    const reply = s.message("help", { author: VIEWER, parentId: root });
    s.database.exec(`INSERT INTO message_reaction(messageId,userId,kind) VALUES ('${reply}','synthetic-otieno','thanks')`);
    const before = Number(row(s, root).changeSeq);
    await s.call("deleteMessage", { id: reply });
    expect(Number(row(s, root).changeSeq)).toBeGreaterThan(Number(row(s, reply).changeSeq));
    expect(Number(row(s, root).changeSeq)).toBeGreaterThan(before);
    expect(s.database.prepare("SELECT COUNT(*) AS n FROM message_reaction").get()).toEqual({ n: 0 });
    const summary = Message.parse(MessageList.parse((await s.call("listMessages", { id: s.channel("help") })).body).items[0]).thread;
    expect(summary.replyCount).toBe(0);
  });
});

describe("reactions", () => {
  it("set the wanted state, so retries never undo themselves, and changes reach pollers", async () => {
    const s = setup();
    const help = s.channel("help");
    const id = s.message("help");
    s.database.exec(`INSERT INTO message_reaction(messageId,userId,kind) VALUES ('${id}','synthetic-otieno','useful')`);
    const start = MessageList.parse((await s.call("listMessages", { id: help })).body);
    const react = (active: boolean, kind = "useful") => s.call("reactToMessage", { id, body: { kind, active } });
    for (let i = 0; i < 2; i++) {
      const on = await react(true);
      expect(MessageReactions.parse(on.body)).toEqual({ messageId: id, reactions: [{ kind: "useful", count: 2, mine: true }] });
    }
    const delta = MessageList.parse((await s.call("listMessages", { id: help, query: `?since=${start.sinceCursor}` })).body);
    expect(delta.items.map((item) => item.reactions)).toEqual([[{ kind: "useful", count: 2, mine: true }]]);
    const quiet = MessageList.parse((await s.call("listMessages", { id: help, query: `?since=${delta.sinceCursor}` })).body);
    expect(quiet.items).toEqual([]);
    for (let i = 0; i < 2; i++) {
      expect(MessageReactions.parse((await react(false)).body).reactions).toEqual([{ kind: "useful", count: 1, mine: false }]);
    }
    expect((await react(true, "heart")).status).toBe(400);
  });

  it("are open to readers of announcements, and closed on archived channels, deleted and hidden messages", async () => {
    const s = setup(cohortMember);
    const announcement = s.message("c04-announcements", { author: "synthetic-faith" });
    expect((await s.call("reactToMessage", { id: announcement, body: { kind: "thanks", active: true } })).status).toBe(200);
    const deleted = s.message("help", { deleted: true });
    const ownHidden = s.message("help", { author: VIEWER, state: "HIDDEN" });
    for (const id of [deleted, ownHidden]) {
      expect((await s.call("reactToMessage", { id, body: { kind: "thanks", active: true } })).status).toBe(409);
    }
    s.database.exec(`UPDATE channel SET archivedAt = 5 WHERE slug = 'c04-announcements'`);
    expect((await s.call("reactToMessage", { id: announcement, body: { kind: "useful", active: true } })).status).toBe(403);
  });
});

describe("read markers", () => {
  it("move only forwards, only through POST /read, and drive the unread counts", async () => {
    const s = setup();
    const help = s.channel("help");
    const [first, second, third] = [s.message("help"), s.message("help"), s.message("help")];
    s.message("help", { author: VIEWER });
    s.message("help", { parentId: first });
    s.message("help", { state: "HIDDEN" });
    const unread = async () => ChannelList.parse((await s.call("listChannels")).body).items.find((c) => c.id === help)!.unreadCount;
    expect(await unread()).toBe(3);
    // Reading pages never moves the marker.
    await s.call("listMessages", { id: help });
    await s.call("listMessages", { id: help, query: `?thread=${first}` });
    expect(s.database.prepare("SELECT COUNT(*) AS n FROM channel_read").get()).toEqual({ n: 0 });

    const mark = async (messageId: string) => ChannelRead.parse((await s.call("markChannelRead", { id: help, body: { messageId } })).body);
    expect(await mark(second)).toEqual({ channelId: help, lastReadMessageId: second, unreadCount: 1 });
    expect(await mark(first)).toEqual({ channelId: help, lastReadMessageId: second, unreadCount: 1 });
    expect(await mark(second)).toEqual({ channelId: help, lastReadMessageId: second, unreadCount: 1 });
    expect(await mark(third)).toEqual({ channelId: help, lastReadMessageId: third, unreadCount: 0 });
    expect(await unread()).toBe(0);
    const after = s.message("help");
    expect(await unread()).toBe(1);
    expect(await mark(first)).toEqual({ channelId: help, lastReadMessageId: third, unreadCount: 1 });
    expect((await mark(after)).unreadCount).toBe(0);
  });

  it("refuse a message from another channel or one hidden from the caller, and count at most 100", async () => {
    const s = setup();
    const help = s.channel("help");
    const elsewhere = s.message("introductions");
    const hidden = s.message("help", { state: "HIDDEN" });
    for (const messageId of [elsewhere, hidden, "message-missing"]) {
      const response = await s.call("markChannelRead", { id: help, body: { messageId } });
      expect([response.status, errorOf(response.body).code]).toEqual([404, "not_found"]);
    }
    expect(s.database.prepare("SELECT COUNT(*) AS n FROM channel_read").get()).toEqual({ n: 0 });
    for (let i = 0; i < 130; i++) s.message("help");
    expect(ChannelList.parse((await s.call("listChannels")).body).items.find((c) => c.id === help)!.unreadCount).toBe(100);
  });
});

describe("query plans", () => {
  it("decide a post through indexes: the nonce, the author's recent messages, the channel counter and the thread", async () => {
    const s = setup();
    s.agree();
    const root = s.message("help");
    const plans: string[] = [];
    const prepare = s.d1.prepare.bind(s.d1);
    s.d1.prepare = ((query: string) => {
      const statement = prepare(query);
      const bind = statement.bind.bind(statement);
      statement.bind = (...values: unknown[]) => {
        if (/^\s*(INSERT|UPDATE)/.test(query)) {
          plans.push(s.database.prepare(`EXPLAIN QUERY PLAN ${query}`).all(...values as never[]).map((step) => String(step.detail)).join("\n"));
        }
        return bind(...values);
      };
      return statement;
    }) as typeof s.d1.prepare;
    expect((await s.call("postMessage", { id: s.channel("help"), body: post("Reply", root) })).status).toBe(201);
    const plan = plans.join("\n");
    expect(plan).toContain("channel_message_author_idx (authorId=? AND createdAt>?)");
    expect(plan).toContain("channel_message_changeSeq_idx (channelId=?)");
    expect(plan).toContain("channel_message_seq_idx (channelId=?)");
    expect(plan).toContain("sqlite_autoindex_channel_conduct_1 (userId=?)");
    expect(plan).not.toMatch(/\bSCAN (?:channel_message|channel_conduct)\b/);
  });
});
