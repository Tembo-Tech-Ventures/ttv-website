import type { APIContext } from "astro";
import { afterEach, describe, expect, it, vi } from "vitest";
import { channelDatabase, post, VIEWER, type ChannelFixture } from "@/lib/channels/test-support";
import { SearchResults, type SearchMessage } from "@/lib/platform/contracts";
import { CHANNEL_ACCESS_MATRIX, type ChannelTarget } from "@/lib/platform/server/capabilities.fixtures";
import { searchRequest } from "./http";
import { EXCERPT_LENGTH, MAX_MATCH_TERMS, MESSAGE_SEARCH, messageMatchExpression } from "./messages";

const fixtures: ChannelFixture[] = [];
afterEach(() => { fixtures.splice(0).forEach(({ database }) => database.close()); vi.restoreAllMocks(); });
function setup(...args: Parameters<typeof channelDatabase>) {
  const fixture = channelDatabase(...args);
  fixtures.push(fixture);
  return fixture;
}

/** Flags as production reads them: from the database, no preview override. */
const DATABASE_FLAGS = { PLATFORM_FLAGS_OVERRIDE: undefined, DEPLOYMENT_ENVIRONMENT: "production" };

async function search(s: ChannelFixture, q: string, options: {
  scope?: string; programId?: string; user?: string; env?: Record<string, unknown>;
} = {}) {
  const params = new URLSearchParams({ q, scope: options.scope ?? "messages", ...options.programId ? { programId: options.programId } : {} });
  const context = { request: new Request(`https://ttv.example/api/search?${params}`),
    locals: { user: { id: options.user ?? VIEWER } } as App.Locals } satisfies Pick<APIContext, "request" | "locals">;
  const response = await searchRequest(context, { DB: s.d1, PLATFORM_FLAGS_OVERRIDE: "all", ...options.env } as Parameters<typeof searchRequest>[1]);
  return { status: response.status, body: await response.json() as unknown };
}
async function messages(s: ChannelFixture, q: string, options: Parameters<typeof search>[2] = {}): Promise<SearchMessage[]> {
  const response = await search(s, q, options);
  expect(response.status).toBe(200);
  return SearchResults.parse(response.body).messages;
}
const ids = (hits: SearchMessage[]) => hits.map((hit) => hit.id);

/** A direct conversation, with these people as its explicit members. */
function direct(s: ChannelFixture, id: string, members: string[]) {
  s.database.prepare("INSERT INTO channel(id, kind, slug, name) VALUES (?, 'DIRECT', 'conversation', 'Conversation')").run(id);
  for (const userId of members) s.database.prepare("INSERT INTO channel_member(channelId, userId) VALUES (?, ?)").run(id, userId);
}
/** Writes a message into a channel by id (direct conversations have no unique slug). */
function messageIn(s: ChannelFixture, channelId: string, id: string, body: string) {
  s.database.prepare(`INSERT INTO channel_message (id, channelId, seq, changeSeq, authorId, body, createdAt)
    SELECT ?, ?, n, n, 'synthetic-otieno', ?, 1 FROM (SELECT coalesce(MAX(changeSeq), 0) + 1 AS n FROM channel_message WHERE channelId = ?)`)
    .run(id, channelId, body, channelId);
}

/**
 * One message mentioning "kipepeo" in a channel of every shape the access rules tell apart, as in
 * CHANNEL_TARGETS: cohort A is Cohort 04, cohort B Cohort 05.
 */
function seedTargets(s: ChannelFixture): Record<ChannelTarget, string> {
  s.database.exec(`UPDATE channel SET archivedAt = 1 WHERE slug IN ('design-crit', 'c04-help');
    UPDATE channel SET postingPolicy = 'STAFF' WHERE slug = 'opportunities'`);
  direct(s, "direct-member", [VIEWER, "synthetic-otieno"]);
  direct(s, "direct-other", ["synthetic-otieno", "synthetic-achieng"]);
  const slugs = {
    community: "help", communityArchived: "design-crit", communityStaff: "opportunities", cohortA: "cohort-04",
    cohortAAnnouncements: "c04-announcements", cohortAArchived: "c04-help", cohortB: "cohort-05", cohortBAnnouncements: "c05-announcements",
  } as const;
  const targets = Object.fromEntries(Object.entries(slugs).map(([target, slug]) => [target, s.message(slug, { body: `kipepeo in ${target}` })]));
  messageIn(s, "direct-member", "dm-member", "kipepeo in directMember");
  messageIn(s, "direct-other", "dm-other", "kipepeo in directOther");
  return { ...targets, directMember: "dm-member", directOther: "dm-other" } as Record<ChannelTarget, string>;
}

describe("message search: access", () => {
  it.each(CHANNEL_ACCESS_MATRIX.filter((item) => item.signedIn !== false))("$name finds messages only in channels they can read", async (item) => {
    const s = setup(item);
    const targets = seedTargets(s);
    // Direct conversations have no page yet (Phase 4), so none is a result, not even for its members.
    const readable = (Object.entries(item.channels) as [ChannelTarget, string][])
      .filter(([target, letters]) => letters.includes("r") && !target.startsWith("direct")).map(([target]) => targets[target]);
    for (const scope of ["messages", "all"]) {
      const hits = await messages(s, "kipepeo", { scope });
      expect({ scope, ids: ids(hits).toSorted() }).toEqual({ scope, ids: readable.toSorted() });
      expect(JSON.stringify(hits)).not.toMatch(/directMember|directOther/);
    }
  });

  it("gives community channels to every signed-in person, institutions included, and nothing signed out", async () => {
    const s = setup({ globalRoles: ["INSTITUTION"] });
    const id = s.message("introductions", { body: "Habari, I build with M-Pesa" });
    expect(ids(await messages(s, "m-pesa"))).toEqual([id]);
    const context = { request: new Request("https://ttv.example/api/search?q=m-pesa&scope=messages"), locals: { user: null } as App.Locals };
    expect((await searchRequest(context, { DB: s.d1, PLATFORM_FLAGS_OVERRIDE: "all" } as Parameters<typeof searchRequest>[1])).status).toBe(404);
  });

  it("drops a cohort's messages on the next search once access is revoked", async () => {
    const s = setup({ applications: [{ programId: "cohort-a", status: "APPROVED" }] });
    const id = s.message("cohort-04", { body: "Cohort secret handshake" });
    expect(ids(await messages(s, "handshake"))).toEqual([id]);
    s.database.exec(`UPDATE programApplication SET status = 'REJECTED' WHERE userId = '${VIEWER}'`);
    expect(await messages(s, "handshake")).toEqual([]);
  });

  it("excludes hidden messages for everyone: their author, the cohort's moderators and admins", async () => {
    const s = setup({ globalRoles: ["ADMIN"], assignments: [{ programId: "cohort-a", name: "TA" }] });
    s.message("cohort-04", { author: VIEWER, body: "Call me on the hidden line", state: "HIDDEN" });
    s.message("help", { body: "Another hidden line", state: "HIDDEN" });
    expect(await messages(s, "hidden line")).toEqual([]);
  });

  it("keeps flagged messages, which stay visible, and replies under a deleted root, but not under a hidden one", async () => {
    const s = setup();
    const flagged = s.message("help", { body: "Shared my sandbox number", state: "FLAGGED" });
    const hiddenRoot = s.message("help", { body: "Root", state: "HIDDEN" });
    s.message("help", { body: "Sandbox reply under a hidden root", parentId: hiddenRoot });
    const deletedRoot = s.message("help", { deleted: true });
    const reply = s.message("help", { body: "Sandbox reply under a deleted root", parentId: deletedRoot });
    expect(ids(await messages(s, "sandbox"))).toEqual([reply, flagged]);
  });

  it("narrows to cohort channels for scope cohort and to one authorized cohort for programId", async () => {
    const s = setup({ assignments: [{ programId: "cohort-a", name: "MENTOR" }, { programId: "cohort-b", name: "MENTOR" }] });
    const a = s.message("cohort-04", { body: "Matatu routes" });
    const b = s.message("cohort-05", { body: "Matatu fares" });
    const community = s.message("help", { body: "Matatu stages" });
    expect(ids(await messages(s, "matatu", { scope: "cohort" })).toSorted()).toEqual([a, b].toSorted());
    expect(ids(await messages(s, "matatu", { scope: "community" }))).toEqual([community]);
    expect(ids(await messages(s, "matatu", { scope: "all", programId: "cohort-a" }))).toEqual([a]);
    expect(ids(await messages(s, "matatu", { scope: "cohort", programId: "cohort-b" }))).toEqual([b]);
    for (const scope of ["people", "projects", "sessionMoments"]) expect(await messages(s, "matatu", { scope })).toEqual([]);
    expect((await search(s, "matatu", { scope: "messages", programId: "cohort-a" })).status).toBe(403);
  });
});

describe("message search: the index follows every write path", () => {
  it("re-indexes an edit and drops an author's delete, through the message APIs", async () => {
    const s = setup();
    s.agree();
    const posted = await s.call("postMessage", { id: s.channel("help"), body: post("Ugali recipe wanted") });
    const id = (posted.body as { id: string }).id;
    expect(ids(await messages(s, "ugali"))).toEqual([id]);
    expect((await s.call("editMessage", { id, body: { body: "Chapati recipe wanted" } })).status).toBe(200);
    expect(await messages(s, "ugali")).toEqual([]);
    const [edited] = await messages(s, "chapati");
    expect(edited).toMatchObject({ id, excerpt: "Chapati recipe wanted" });
    expect((await s.call("deleteMessage", { id })).status).toBe(200);
    expect(await messages(s, "chapati")).toEqual([]);
  });

  it("drops a hidden message and brings it back on restore", async () => {
    const s = setup();
    const id = s.message("help", { body: "Restorable question" });
    s.database.prepare("UPDATE channel_message SET moderationState = 'HIDDEN', moderationReasons = '[\"Abuse\"]', hiddenAt = 5 WHERE id = ?").run(id);
    expect(await messages(s, "restorable")).toEqual([]);
    s.database.prepare("UPDATE channel_message SET moderationState = 'VISIBLE', moderationReasons = '[]', hiddenAt = NULL WHERE id = ?").run(id);
    expect(ids(await messages(s, "restorable"))).toEqual([id]);
  });

  it("never searches stored embed snapshots, only the body", async () => {
    const s = setup();
    const id = s.message("show-your-work", { body: "My project" });
    s.database.prepare(`UPDATE channel_message SET embeds = '[{"type":"project","title":"Secret ledger"}]' WHERE id = ?`).run(id);
    expect(await messages(s, "ledger")).toEqual([]);
    expect(ids(await messages(s, "project"))).toEqual([id]);
  });
});

describe("message search: queries are text, never FTS5 syntax", () => {
  it.each([
    ["webhook", '"webhook"*'],
    ["Ok go", '"Ok" "go"'],
    ['say "hi"', '"say"* """hi"""*'],
    ["a OR b", '"a" "OR" "b"'],
    ["NEAR(webhook retry)", '"NEAR(webhook"* "retry)"*'],
    ["body:secret", '"body:secret"*'],
    ["^start *", '"^start"*'],
    ["web* -retry", '"web*"* "-retry"*'],
    ["  spaced\tout\n", '"spaced"* "out"*'],
    ["repeat repeat", '"repeat"*'],
    ["café ñandú", '"café"* "ñandú"*'],
    ["\" * - ( ) : ^", null],
  ])("%j becomes %j", (q, expected) => {
    expect(messageMatchExpression(q)).toBe(expected);
  });

  it(`matches at most ${MAX_MATCH_TERMS} terms`, () => {
    const terms = Array.from({ length: 40 }, (_, i) => `term${i}`);
    expect(messageMatchExpression(terms.join(" "))?.split(" ")).toHaveLength(MAX_MATCH_TERMS);
  });

  it.each(['"', '"unbalanced', "NEAR(alpha gamma)", "alpha OR gamma", "NOT alpha", "*", "alpha*", "body:alpha", "^alpha",
    "(alpha", "alpha AND", "'; DROP TABLE channel_message; --", "rowid:1", "channel_message_fts:alpha", "{body}: alpha", "\u0000alpha"])(
    "treats %j as text: no error, no operator", async (q) => {
      const s = setup();
      s.message("help", { body: "alpha beta" });
      s.message("help", { body: "gamma" });
      const response = await search(s, q);
      expect(response.status).toBe(200);
      const hits = SearchResults.parse(response.body).messages;
      // Only a query whose every term is a word (or the start of one) in "alpha beta" may find it; "gamma" never comes with it.
      expect(hits.every((hit) => hit.excerpt === "alpha beta")).toBe(true);
      expect(s.database.prepare("SELECT COUNT(*) AS n FROM channel_message").get()).toEqual({ n: 2 });
    });

  it("matches whole words, word starts from three characters, any case and diacritics", async () => {
    const s = setup();
    const webhook = s.message("help", { body: "Webhook retries" });
    const we = s.message("help", { body: "We ship" });
    const cafe = s.message("help", { body: "Meet at the Café" });
    expect(ids(await messages(s, "webh"))).toEqual([webhook]);
    expect(ids(await messages(s, "we"))).toEqual([we]);
    expect(ids(await messages(s, "CAFE"))).toEqual([cafe]);
    expect(ids(await messages(s, "webhook ship"))).toEqual([]);
  });

  it("reads nothing for a query without a word", async () => {
    const s = setup();
    const prepare = vi.spyOn(s.d1, "prepare");
    expect(await messages(s, '" * ( )')).toEqual([]);
    expect(prepare.mock.calls.some(([query]) => query.includes("channel_message_fts"))).toBe(false);
  });
});

describe("message search: results", () => {
  it("are the newest ten matches, an edit keeping its place, as bounded plain-text excerpts", async () => {
    const s = setup();
    s.agree();
    const ordered = Array.from({ length: 12 }, (_, i) => s.message("help", { author: VIEWER, body: `Jollof debate ${i}` })).toReversed();
    expect(ids(await messages(s, "jollof"))).toEqual(ordered.slice(0, 10));
    expect((await s.call("editMessage", { id: ordered[11], body: { body: "Jollof debate, edited" } })).status).toBe(200);
    expect(ids(await messages(s, "jollof"))).toEqual(ordered.slice(0, 10));

    const long = s.message("help", { body: `needle ${"x".repeat(9_000)} ${"word ".repeat(150)}` });
    const [hit] = await messages(s, "needle");
    expect(hit?.id).toBe(long);
    expect(hit!.excerpt.length).toBeLessThanOrEqual(EXCERPT_LENGTH);
    expect(hit!.excerpt.startsWith("needle")).toBe(true);
  });

  it("link to the message in its channel, or its thread, and say who can see it", async () => {
    const s = setup({ applications: [{ programId: "cohort-a", status: "APPROVED" }] });
    const root = s.message("cohort-04", { body: "Ndizi root", author: "synthetic-achieng" });
    const reply = s.message("cohort-04", { body: "Ndizi reply", parentId: root, tembo: true });
    const community = s.message("help", { body: "Ndizi elsewhere", author: null });
    s.database.exec(`UPDATE "user" SET image = 'https://example.test/achieng.png' WHERE id = 'synthetic-achieng'`);
    const hits = await messages(s, "ndizi");
    expect(hits).toEqual([
      { id: community, channelId: s.channel("help"), parentId: null, createdAt: expect.any(Number), excerpt: "Ndizi elsewhere",
        author: { id: null, name: "Deleted user", avatarUrl: null, roleBadges: [] },
        href: `/dashboard/community/c/help?message=${community}`,
        visibility: { kind: "COMMUNITY", label: "#help · signed-in members" } },
      { id: reply, channelId: s.channel("cohort-04"), parentId: root, createdAt: expect.any(Number), excerpt: "Ndizi reply",
        author: { id: null, name: "Tembo", avatarUrl: null, roleBadges: [{ kind: "AI", label: "AI", programId: null }] },
        href: `/dashboard/cohort/c/cohort-04?thread=${root}&message=${reply}`,
        visibility: { kind: "COHORT", label: "#cohort-04 · only this cohort" } },
      { id: root, channelId: s.channel("cohort-04"), parentId: null, createdAt: expect.any(Number), excerpt: "Ndizi root",
        author: { id: "synthetic-achieng", name: "Achieng Atieno", avatarUrl: "https://example.test/achieng.png", roleBadges: [] },
        href: `/dashboard/cohort/c/cohort-04?message=${root}`,
        visibility: { kind: "COHORT", label: "#cohort-04 · only this cohort" } },
    ]);
  });
});

describe("message search: the channels flag", () => {
  it.each(["OFF", "STAFF"])("finds no messages and reads no channel while channels is %s for the caller", async (audience) => {
    const s = setup();
    s.message("help", { body: "Flagged off" });
    s.database.exec(`UPDATE feature_flag SET audience = 'ALL' WHERE key = 'spaces';
      UPDATE feature_flag SET audience = '${audience}' WHERE key = 'channels'`);
    const prepare = vi.spyOn(s.d1, "prepare");
    expect(await messages(s, "flagged", { env: DATABASE_FLAGS })).toEqual([]);
    expect(prepare.mock.calls.some(([query]) => /channel_message|"channel"/.test(query))).toBe(false);
  });

  it("finds messages for staff at STAFF", async () => {
    const s = setup({ globalRoles: ["ADMIN"] });
    const id = s.message("help", { body: "Staff preview" });
    s.database.exec(`UPDATE feature_flag SET audience = 'STAFF' WHERE key IN ('spaces', 'channels')`);
    expect(ids(await messages(s, "preview", { env: DATABASE_FLAGS }))).toEqual([id]);
  });
});

describe("message search: cost", () => {
  it("uses the FTS index newest first and joins each match by key: no table scan, no sort", () => {
    const s = setup();
    const plan = (s.database.prepare(`EXPLAIN QUERY PLAN ${MESSAGE_SEARCH}`).all('"kipepeo"*', "[]", 10) as { detail: string }[])
      .map((row) => row.detail);
    expect(plan[0]).toMatch(/^SCAN f VIRTUAL TABLE INDEX \d+:M/);
    expect(plan).toContain("SEARCH s USING INTEGER PRIMARY KEY (rowid=?)");
    expect(plan).toContain("SEARCH m USING INDEX channel_message_channel_id_idx (channelId=? AND id=?)");
    expect(plan.join("\n")).not.toMatch(/TEMP B-TREE|SCAN (m|s|p|u)\b|SCAN channel_message/);
  });

  it("spends two statements on messages: the readable channels and the match", async () => {
    const s = setup({ applications: [{ programId: "cohort-a", status: "APPROVED" }] });
    s.message("help", { body: "Budget check" });
    s.database.exec("UPDATE feature_flag SET audience = 'ALL' WHERE key IN ('spaces', 'channels')");
    const prepare = vi.spyOn(s.d1, "prepare");
    expect(await messages(s, "budget", { env: DATABASE_FLAGS })).toHaveLength(1);
    // The flags, capabilitiesFor's three reads, the channels and the match.
    expect(prepare.mock.calls.length).toBe(6);
    prepare.mockClear();
    // "all" adds people, projects and this cohort's session moments.
    await messages(s, "budget", { scope: "all", env: DATABASE_FLAGS });
    expect(prepare.mock.calls.length).toBe(9);
  });

  it("fails closed with one generic error when the match fails", async () => {
    const s = setup();
    const prepare = s.d1.prepare.bind(s.d1);
    vi.spyOn(s.d1, "prepare").mockImplementation((query) => {
      if (query.includes("channel_message_fts")) throw new Error("SQL secret");
      return prepare(query);
    });
    const response = await search(s, "anything");
    expect(response).toEqual({ status: 500, body: { error: { code: "server", message: "Could not search right now." } } });
  });
});
