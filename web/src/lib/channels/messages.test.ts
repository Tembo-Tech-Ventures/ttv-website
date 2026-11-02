import { afterEach, describe, expect, it } from "vitest";
import { MessageList, type Message } from "@/lib/platform/contracts";
import { CursorExpiredError, CursorInvalidError, encodeCursor } from "./cursor";
import { listMessages, PAGE_SIZE, readMessage, SINCE_LIMIT, type ReadContext } from "./messages";
import { channelDatabase, VIEWER, type ChannelFixture } from "./test-support";

const fixtures: ChannelFixture[] = [];
afterEach(() => { fixtures.splice(0).forEach(({ database }) => database.close()); });
function setup() {
  const fixture = channelDatabase({ applications: [{ programId: "cohort-a", status: "APPROVED" }] });
  fixtures.push(fixture);
  return fixture;
}
const reader = (s: ChannelFixture, slug: string, canModerate = false, viewerId = VIEWER): ReadContext => ({
  db: s.d1, viewerId,
  channel: { id: s.channel(slug), kind: slug.startsWith("c") && /^c(ohort-)?\d/.test(slug) ? "COHORT" : "COMMUNITY",
    programId: /^c(ohort-)?04/.test(slug) ? "cohort-a" : null,
    capabilities: { canPost: true, canModerate, canShareSessionClip: false } },
});
const ids = (page: MessageList) => page.items.map((item) => item.id);

/** Walks a feed back from the latest page through every beforeCursor. */
async function history(ctx: ReadContext, thread?: string) {
  const pages: MessageList[] = [MessageList.parse(await listMessages(ctx, { thread }))];
  while (pages[0]!.beforeCursor) pages.unshift(MessageList.parse(await listMessages(ctx, { thread, before: pages[0]!.beforeCursor })));
  return pages;
}

describe("message pages", () => {
  it("pages back through history with gaps, oldest first, with no repeats and no holes", async () => {
    const s = setup();
    const roots: string[] = [];
    for (let i = 0; i < 2 * PAGE_SIZE + 7; i++) {
      roots.push(s.message("help", { createdAt: 10_000 + i }));
      // Replies, a deleted placeholder and another person's hidden message sit between the roots.
      if (i % 9 === 0) s.message("help", { parentId: roots.at(-1)! });
      if (i % 13 === 0) roots.push(s.message("help", { deleted: true }));
      if (i % 17 === 0) s.message("help", { state: "HIDDEN" });
      // Another channel's traffic shares nothing with this feed.
      if (i % 5 === 0) s.message("introductions");
    }
    const pages = await history(reader(s, "help"));
    expect(pages).toHaveLength(3);
    expect(pages.map((page) => page.items.length)).toEqual([roots.length - 2 * PAGE_SIZE, PAGE_SIZE, PAGE_SIZE]);
    expect(pages.flatMap(ids)).toEqual(roots);
    expect(pages.every((page) => page.thread === null && page.removedIds.length === 0)).toBe(true);
    expect(pages[0]!.beforeCursor).toBeNull();
    const deleted = pages.flatMap((page) => page.items).filter((item) => item.deleted);
    expect(deleted.length).toBeGreaterThan(0);
    expect(deleted.every((item) => item.body === "" && item.embeds.length === 0 && item.reactions.length === 0)).toBe(true);
  });

  it("an empty feed is one empty page with a polling checkpoint", async () => {
    const s = setup();
    const page = MessageList.parse(await listMessages(reader(s, "design-crit"), {}));
    expect(page).toMatchObject({ items: [], beforeCursor: null, removedIds: [], thread: null });
    expect(MessageList.parse(await listMessages(reader(s, "design-crit"), { since: page.sinceCursor })).items).toEqual([]);
  });

  it("a thread feed holds that thread's replies only, and the root's summary counts what everyone sees", async () => {
    const s = setup();
    const root = s.message("help", { author: VIEWER });
    const other = s.message("help");
    const replies = [s.message("help", { parentId: root, author: "synthetic-achieng" }), s.message("help", { parentId: root, tembo: true })];
    s.message("help", { parentId: other });
    s.message("help", { parentId: root, state: "HIDDEN" });
    s.message("help", { parentId: root, deleted: true, author: "synthetic-achieng" });
    const page = MessageList.parse(await listMessages(reader(s, "help"), { thread: root }));
    expect(page.thread).toBe(root);
    expect(ids(page)).toEqual([...replies, expect.any(String)]);
    expect(page.items.at(-1)!.deleted).toBe(true);
    const tembo = page.items.find((item) => item.authorKind === "TEMBO");
    expect(tembo).toMatchObject({ author: { id: null, name: "Tembo", roleBadges: [{ kind: "AI" }] }, temboScope: "COMMUNITY" });
    const summary = (await readMessage(reader(s, "help"), root))!.thread;
    expect(summary).toMatchObject({ replyCount: 2, participantIds: ["synthetic-achieng"] });
    expect(summary.lastReplyAt).toBeGreaterThan(0);
  });

  it.each(["a reply", "another channel's root", "a missing id", "a hidden root"] as const)("refuses %s as a thread with 404", async (name) => {
    const s = setup();
    const root = s.message("help");
    const target = {
      "a reply": () => s.message("help", { parentId: root }),
      "another channel's root": () => s.message("introductions"),
      "a missing id": () => "message-missing",
      "a hidden root": () => s.message("help", { state: "HIDDEN" }),
    }[name]();
    await expect(listMessages(reader(s, "help"), { thread: target })).rejects.toMatchObject({ status: 404, code: "not_found" });
  });

  it("shows a hidden message only to its author and the channel's moderators, with moderation details", async () => {
    const s = setup();
    const hidden = s.message("help", { state: "HIDDEN", author: VIEWER });
    const flagged = s.message("help", { state: "FLAGGED" });
    const own = (await listMessages(reader(s, "help"), {})).items;
    expect(own.map((item) => [item.id, item.moderation])).toEqual([
      [hidden, { state: "HIDDEN", reasons: ["Synthetic reason"], reviewRequested: false }], [flagged, null],
    ]);
    const others = (await listMessages(reader(s, "help", false, "synthetic-achieng"), {})).items;
    expect(others.map((item) => [item.id, item.moderation])).toEqual([[flagged, null]]);
    const moderator = (await listMessages(reader(s, "help", true, "synthetic-achieng"), {})).items;
    expect(moderator.map((item) => item.moderation?.state)).toEqual(["HIDDEN", "FLAGGED"]);
    expect(await readMessage(reader(s, "help", false, "synthetic-achieng"), hidden)).toBeNull();
  });

  it("returns the client nonce only to its author, and display badges for this cohort only", async () => {
    const s = setup();
    s.database.exec(`INSERT OR IGNORE INTO Roles(id,name) VALUES ('ADMIN','ADMIN'),('MENTOR','MENTOR');
      INSERT INTO UserRoles(id,userId,roleId) SELECT 'a','synthetic-faith',id FROM Roles WHERE name = 'ADMIN';
      INSERT INTO UserRoles(id,userId,roleId) SELECT 'm','synthetic-achieng',id FROM Roles WHERE name = 'MENTOR';
      INSERT INTO programRole(id,userId,programId,name) VALUES ('b-ta','synthetic-otieno','cohort-b','TA');`);
    const mine = s.message("cohort-04", { author: VIEWER, nonce: "mine-1" });
    s.message("cohort-04", { author: "synthetic-faith", nonce: "faith-1" });
    s.message("cohort-04", { author: "synthetic-achieng" });
    s.message("cohort-04", { author: "synthetic-otieno" });
    // What deleting Otieno's account does to their messages (ON DELETE SET NULL).
    s.database.exec(`UPDATE channel_message SET authorId = NULL WHERE authorId = 'synthetic-otieno'`);
    const page = await listMessages(reader(s, "cohort-04"), {});
    const byAuthor = (name: string) => page.items.find((item) => item.author.name === name)!;
    expect(page.items.find((item) => item.id === mine)!.clientNonce).toBe("mine-1");
    expect(byAuthor("Faith Njeri").clientNonce).toBeNull();
    expect(byAuthor("Wanjiku Njeri").author.roleBadges).toEqual([{ kind: "COHORT", label: "Cohort 04", programId: "cohort-a" }]);
    expect(byAuthor("Faith Njeri").author.roleBadges.map((badge) => badge.kind)).toEqual(["STAFF", "TA"]);
    expect(byAuthor("Achieng Atieno").author.roleBadges).toEqual([
      { kind: "MENTOR", label: "Mentor", programId: null }, { kind: "ALUMNI", label: "Alumni · Cohort 04", programId: "cohort-a" },
    ]);
    // A deleted account keeps its messages as "Deleted user"; cohort B's TA role means nothing here.
    expect(byAuthor("Deleted user").author).toEqual({ id: null, name: "Deleted user", avatarUrl: null, roleBadges: [] });
    const community = await listMessages(reader(s, "help"), {});
    expect(community.items).toEqual([]);
  });
});

describe("since polling", () => {
  it("carries new messages, edits, deletions, reactions and reply counts, then removes what became hidden", async () => {
    const s = setup();
    const kept = s.message("help");
    const edited = s.message("help");
    const doomed = s.message("help");
    const hiddenLater = s.message("help");
    const ctx = reader(s, "help");
    const first = MessageList.parse(await listMessages(ctx, {}));
    expect(ids(first)).toEqual([kept, edited, doomed, hiddenLater]);

    const bump = (id: string, set: string) => s.database.exec(`UPDATE channel_message SET ${set},
      changeSeq = (SELECT MAX(changeSeq) + 1 FROM channel_message) WHERE id = '${id}'`);
    bump(edited, "body = 'Edited', editedAt = 5");
    bump(doomed, "body = '', deletedAt = 5");
    bump(hiddenLater, "moderationState = 'HIDDEN', moderationReasons = '[\"Abuse\"]', hiddenAt = 5");
    const added = s.message("help");
    // Created and hidden between polls: never seen, so never named.
    const neverSeen = s.message("help", { state: "HIDDEN" });
    s.message("help", { parentId: kept });

    const delta = MessageList.parse(await listMessages(ctx, { since: first.sinceCursor }));
    expect(ids(delta)).toEqual([edited, doomed, added]);
    expect(delta.items.map((item) => [item.edited, item.deleted])).toEqual([[true, false], [false, true], [false, false]]);
    expect(delta.removedIds).toEqual([hiddenLater]);
    expect(delta.removedIds).not.toContain(neverSeen);
    expect(delta.beforeCursor).not.toBeNull();
    const older = MessageList.parse(await listMessages(ctx, { before: delta.beforeCursor! }));
    expect(ids(older)).toEqual([kept, edited, doomed]);

    // The reply is in the thread feed, not this one; nothing else changed since.
    const quiet = MessageList.parse(await listMessages(ctx, { since: delta.sinceCursor }));
    expect(quiet).toMatchObject({ items: [], removedIds: [], beforeCursor: null });
  });

  it("is contiguous: a capped delta continues on the next poll with no change lost or repeated", async () => {
    const s = setup();
    const ctx = reader(s, "help");
    const start = MessageList.parse(await listMessages(ctx, {}));
    const created = Array.from({ length: SINCE_LIMIT + 30 }, (_, i) => {
      if (i % 7 === 0) s.message("help", { state: "HIDDEN" });
      return s.message("help");
    });
    const first = MessageList.parse(await listMessages(ctx, { since: start.sinceCursor }));
    const second = MessageList.parse(await listMessages(ctx, { since: first.sinceCursor }));
    const third = MessageList.parse(await listMessages(ctx, { since: second.sinceCursor }));
    expect([...ids(first), ...ids(second)]).toEqual(created);
    expect(first.items.length).toBeLessThan(SINCE_LIMIT);
    expect(third.items).toEqual([]);
  });

  it("binds cursors to their feed and direction, and expires those a reset feed cannot honour", async () => {
    const s = setup();
    const root = s.message("help");
    s.message("introductions");
    const help = reader(s, "help");
    const page = await listMessages(help, {});
    await expect(listMessages(reader(s, "introductions"), { since: page.sinceCursor })).rejects.toBeInstanceOf(CursorInvalidError);
    await expect(listMessages(help, { thread: root, since: page.sinceCursor })).rejects.toBeInstanceOf(CursorInvalidError);
    await expect(listMessages(help, { before: page.sinceCursor })).rejects.toBeInstanceOf(CursorInvalidError);
    for (const junk of ["x", "eyJ2IjoxfQ", "%%%", btoa("[]")]) {
      await expect(listMessages(help, { since: junk })).rejects.toBeInstanceOf(CursorInvalidError);
    }
    const ahead = await encodeCursor(help.channel.id, null, "since", 99);
    await expect(listMessages(help, { since: ahead })).rejects.toBeInstanceOf(CursorExpiredError);
    const before = await encodeCursor(help.channel.id, null, "before", 99);
    await expect(listMessages(help, { before })).rejects.toBeInstanceOf(CursorExpiredError);
    const future = btoa(JSON.stringify({ v: 2, f: "0".repeat(16), d: "since", p: 1 })).replace(/=+$/, "");
    await expect(listMessages(help, { since: future })).rejects.toBeInstanceOf(CursorExpiredError);
  });

  it("reads each page in one statement, through the indexes", async () => {
    const s = setup();
    for (let i = 0; i < 5; i++) s.message("help", { parentId: i > 0 ? "message-1" : null });
    const plans: string[] = [];
    const prepare = s.d1.prepare.bind(s.d1);
    s.d1.prepare = ((query: string) => {
      const statement = prepare(query);
      const bind = statement.bind.bind(statement);
      statement.bind = (...values: unknown[]) => {
        plans.push(s.database.prepare(`EXPLAIN QUERY PLAN ${query}`).all(...values as never[])
          .map((row) => String(row.detail)).join("\n"));
        return bind(...values);
      };
      return statement;
    }) as typeof s.d1.prepare;
    const ctx = reader(s, "help");
    const latest = await listMessages(ctx, {});
    await listMessages(ctx, { since: latest.sinceCursor });
    await listMessages(ctx, { thread: "message-1" });
    expect(plans).toHaveLength(4);
    expect(plans[0]).toContain("channel_message_thread_idx (channelId=? AND parentId=?)");
    expect(plans[1]).toContain("channel_message_changeSeq_idx (channelId=? AND changeSeq>?)");
    expect(plans.join("\n")).not.toMatch(/SCAN m\b/);
  });
});

describe("message DTOs", () => {
  it("validate against the contract", async () => {
    const s = setup();
    const root = s.message("cohort-04", { author: VIEWER });
    s.message("cohort-04", { parentId: root, tembo: true });
    s.database.exec(`INSERT INTO message_reaction(messageId,userId,kind) VALUES ('${root}','${VIEWER}','useful'),('${root}','synthetic-otieno','useful'),('${root}','synthetic-otieno','thanks')`);
    const message: Message = (await readMessage(reader(s, "cohort-04"), root))!;
    expect(message.reactions).toEqual([{ kind: "useful", count: 2, mine: true }, { kind: "thanks", count: 1, mine: false }]);
    expect(MessageList.parse({ items: [message], beforeCursor: null, sinceCursor: "x", thread: null, removedIds: [] }).items[0]).toEqual(message);
  });
});
