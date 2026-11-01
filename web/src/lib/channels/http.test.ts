import { afterEach, describe, expect, it, vi } from "vitest";
import {
  ChannelList, ChannelRead, ErrorEnvelope, Message, MessageList, MessageReactions, ROUTES,
} from "@/lib/platform/contracts";
import { CHANNEL_ACCESS_MATRIX, type ChannelTarget } from "@/lib/platform/server/capabilities.fixtures";
import type { ChannelOperation } from "./http";
import { channelDatabase, post, VIEWER, type ChannelFixture } from "./test-support";

vi.mock("@/lib/observability/errors", async (importOriginal) => ({
  ...await importOriginal<typeof import("@/lib/observability/errors")>(),
  recordErrorInBackground: vi.fn(),
}));

const fixtures: ChannelFixture[] = [];
afterEach(() => { fixtures.splice(0).forEach(({ database }) => database.close()); vi.restoreAllMocks(); });
function setup(...args: Parameters<typeof channelDatabase>) {
  const fixture = channelDatabase(...args);
  fixtures.push(fixture);
  return fixture;
}
const errorOf = (body: unknown) => ErrorEnvelope.parse(body).error;
/** Flags as production reads them: from the database, no preview override. */
const DATABASE_FLAGS = { PLATFORM_FLAGS_OVERRIDE: undefined, DEPLOYMENT_ENVIRONMENT: "production" };

/** Every route with a valid request for it, against a message Wanjiku wrote in #help. */
function everyRoute(s: ChannelFixture) {
  const help = s.channel("help");
  const own = s.message("help", { author: VIEWER, body: "Mine" });
  return [
    ["listChannels", {}], ["listMessages", { id: help }], ["postMessage", { id: help, body: post() }],
    ["markChannelRead", { id: help, body: { messageId: own } }], ["editMessage", { id: own, body: { body: "Changed" } }],
    ["reactToMessage", { id: own, body: { kind: "useful", active: true } }], ["deleteMessage", { id: own }],
  ] as const satisfies readonly (readonly [ChannelOperation, Parameters<ChannelFixture["call"]>[1]])[];
}

describe("channel APIs: gates", () => {
  it("are 404 flag_off on every route while channels is off, before reading any channel data", async () => {
    for (const audience of ["OFF", "STAFF"]) {
      const s = setup();
      s.agree();
      s.database.exec(`UPDATE feature_flag SET audience = '${audience}' WHERE key = 'channels'`);
      for (const [operation, options] of everyRoute(s)) {
        const prepare = vi.spyOn(s.d1, "prepare");
        const response = await s.call(operation, { ...options, env: DATABASE_FLAGS });
        expect([response.status, errorOf(response.body).code], `${audience} ${operation}`).toEqual([404, "flag_off"]);
        const queries = prepare.mock.calls.map(([query]) => query);
        expect(queries.every((query) => /feature_flag|UserRoles/.test(query)), `${queries.join("\n")}`).toBe(true);
        prepare.mockRestore();
      }
      expect(s.database.prepare("SELECT body, deletedAt FROM channel_message").all()).toEqual([{ body: "Mine", deletedAt: null }]);
    }
  });

  it("open to staff at STAFF and to everyone at ALL", async () => {
    const admin = setup({ globalRoles: ["ADMIN"] });
    admin.database.exec("UPDATE feature_flag SET audience = 'STAFF' WHERE key = 'channels'");
    expect((await admin.call("listChannels", { env: DATABASE_FLAGS })).status).toBe(200);
    const member = setup();
    member.database.exec("UPDATE feature_flag SET audience = 'ALL' WHERE key = 'channels'");
    expect((await member.call("listChannels", { env: DATABASE_FLAGS })).status).toBe(200);
  });

  it("are 404 signed out, 403 for personal access tokens, and refuse cross-origin writes", async () => {
    const s = setup();
    s.agree();
    for (const [operation, options] of everyRoute(s)) {
      expect((await s.call(operation, { ...options, user: null })).status, `${operation}`).toBe(404);
      const token = await s.call(operation, { ...options, locals: { personalAccessToken: { id: "pat", scopes: ["admin:read"] } } as never });
      expect([token.status, errorOf(token.body).code], `${operation}`).toEqual([403, "forbidden"]);
      const write = ROUTES[operation].method !== "GET";
      for (const origin of [null, "https://evil.example"]) {
        const response = await s.call(operation, { ...options, origin });
        if (write) expect([response.status, errorOf(response.body).message], `${operation} ${origin}`).toEqual([403, "Same-origin request required."]);
        else expect(response.status, `${operation}`).toBe(200);
      }
    }
    expect(s.database.prepare("SELECT body FROM channel_message").all()).toEqual([{ body: "Mine" }]);
  });

  it("let agent sessions act as their person", async () => {
    const s = setup();
    s.agree();
    const response = await s.call("postMessage", { id: s.channel("help"), body: post(),
      locals: { session: { userAgent: "ttv-agent:isolated-preview:persona" } } as never });
    expect(response.status).toBe(201);
  });
});

describe("channel APIs: access matrix", () => {
  /** The seeded channel standing in for each CHANNEL_TARGETS shape (communityStaff has no seed). */
  const SLUGS: Partial<Record<ChannelTarget, string>> = {
    community: "help", communityArchived: "design-crit", cohortA: "cohort-04", cohortAAnnouncements: "c04-announcements",
    cohortAArchived: "c04-help", cohortB: "cohort-05", cohortBAnnouncements: "c05-announcements",
  };

  it.each(CHANNEL_ACCESS_MATRIX)("reads, posts and lists exactly per channelAccessFor: $name", async (fixture) => {
    const s = setup(fixture);
    s.agree();
    s.database.exec(`UPDATE channel SET archivedAt = 5 WHERE slug IN ('design-crit', 'c04-help');
      INSERT INTO channel(id, kind, slug, name) VALUES ('direct-member', 'DIRECT', 'review', 'Review'), ('direct-other', 'DIRECT', 'review', 'Review');
      INSERT INTO channel_member(channelId, userId) VALUES ('direct-member', '${VIEWER}'), ('direct-other', 'synthetic-otieno');`);
    const user = fixture.signedIn === false ? null : VIEWER;
    const listed = await s.call("listChannels", { user });
    const visible = user ? new Set(ChannelList.parse(listed.body).items.map((channel) => channel.id)) : new Set<string>();
    const targets = { ...SLUGS, directMember: "direct-member", directOther: "direct-other" };
    for (const [target, slug] of Object.entries(targets) as [ChannelTarget, string][]) {
      const id = slug.startsWith("direct-") ? slug : s.channel(slug);
      const letters = fixture.channels[target];
      const label = `${fixture.name} ${target}`;
      expect(visible.has(id), `${label}`).toBe(letters.includes("r"));
      const read = await s.call("listMessages", { id, user });
      expect(read.status, `${label}`).toBe(letters.includes("r") ? 200 : 404);
      const sent = await s.call("postMessage", { id, user, body: post() });
      expect(sent.status, `${label}`).toBe(letters.includes("p") ? 201 : letters.includes("r") ? 403 : 404);
    }
  });

  it("gives the same 404 for another cohort's channel and a channel that does not exist", async () => {
    const s = setup({ applications: [{ programId: "cohort-a", status: "APPROVED" }] });
    const foreign = await s.call("listMessages", { id: s.channel("cohort-05") });
    const missing = await s.call("listMessages", { id: "0".repeat(32) });
    expect([foreign.status, foreign.body]).toEqual([missing.status, missing.body]);
    expect(errorOf(foreign.body)).toEqual({ code: "not_found", message: "Channel not found." });
  });
});

describe("channel APIs: contracts", () => {
  it("answer every route with its ROUTES response schema", async () => {
    const s = setup();
    s.agree();
    const help = s.channel("help");
    s.message("help");
    const channels = await s.call("listChannels");
    expect(ChannelList.parse(channels.body).items.map((channel) => channel.slug))
      .toEqual(["introductions", "show-your-work", "help", "opportunities", "design-crit"]);
    const created = await s.call("postMessage", { id: help, body: post("Hello") });
    const message = Message.parse(created.body);
    expect(MessageList.parse((await s.call("listMessages", { id: help })).body).items.map((item) => item.body)).toEqual(["Synthetic message 1", "Hello"]);
    expect(MessageList.parse((await s.call("listMessages", { id: help, query: `?thread=${message.id}` })).body).thread).toBe(message.id);
    expect(ChannelRead.parse((await s.call("markChannelRead", { id: help, body: { messageId: message.id } })).body).unreadCount).toBe(0);
    expect(Message.parse((await s.call("editMessage", { id: message.id, body: { body: "Hello again" } })).body).body).toBe("Hello again");
    expect(MessageReactions.parse((await s.call("reactToMessage", { id: message.id, body: { kind: "agree", active: true } })).body).reactions)
      .toEqual([{ kind: "agree", count: 1, mine: true }]);
    expect(Message.parse((await s.call("deleteMessage", { id: message.id })).body).deleted).toBe(true);
    for (const response of [channels, created]) expect(response.response.headers.get("Cache-Control")).toBe("no-store");
  });

  it.each([
    ["a duplicate parameter", "?thread=a&thread=b"], ["an unknown parameter", "?limit=5"], ["before and since together", "?before=a&since=b"],
    ["an empty cursor", "?since="], ["a malformed cursor", "?since=not-a-cursor"],
  ])("refuse %s with 400 validation", async (_name, query) => {
    const s = setup();
    const response = await s.call("listMessages", { id: s.channel("help"), query });
    expect([response.status, errorOf(response.body).code]).toEqual([400, "validation"]);
  });

  it("answer an expired cursor with 410, so the store takes a fresh snapshot", async () => {
    const s = setup();
    const help = s.channel("help");
    s.message("help");
    const page = MessageList.parse((await s.call("listMessages", { id: help })).body);
    s.database.exec("DELETE FROM channel_message");
    const response = await s.call("listMessages", { id: help, query: `?since=${page.sinceCursor}` });
    expect([response.status, errorOf(response.body).code]).toEqual([410, "validation"]);
  });

  it.each([
    ["no body", undefined, 400], ["a blank body", { ...post(), body: "   " }, 400], ["an unknown field", { ...post(), pinned: true }, 400],
    ["a bad nonce", { ...post(), clientNonce: "has spaces" }, 400], ["too long a message", { ...post(), body: "x".repeat(10_001) }, 400],
    ["more than the byte limit", { ...post(), body: "😀".repeat(9_000), pad: "x".repeat(40_000) }, 413],
  ])("refuse a post with %s", async (_name, body, status) => {
    const s = setup();
    s.agree();
    const response = await s.call("postMessage", { id: s.channel("help"), body });
    expect([response.status, errorOf(response.body).code]).toEqual([status, "validation"]);
    expect(s.database.prepare("SELECT COUNT(*) AS n FROM channel_message").get()).toEqual({ n: 0 });
  });

  it("accept the longest legal message", async () => {
    const s = setup();
    s.agree();
    const response = await s.call("postMessage", { id: s.channel("help"), body: post("😀".repeat(5_000)) });
    expect(response.status).toBe(201);
  });

  it("report unexpected failures as 500 server errors without details", async () => {
    const { recordErrorInBackground } = await import("@/lib/observability/errors");
    const s = setup();
    const help = s.channel("help");
    const prepare = s.d1.prepare.bind(s.d1);
    const page = vi.spyOn(s.d1, "prepare").mockImplementation(((query: string) => {
      if (query.includes("FROM channel_message m")) throw new Error("D1 exploded with a secret");
      return prepare(query);
    }) as typeof s.d1.prepare);
    const response = await s.call("listMessages", { id: help });
    expect(page.mock.results.filter((result) => result.type === "throw")).toHaveLength(1);
    expect([response.status, errorOf(response.body)]).toEqual([500, { code: "server", message: "Could not complete the channel request." }]);
    expect(recordErrorInBackground).toHaveBeenCalledWith(undefined, expect.anything(), expect.objectContaining({ route: ROUTES.listMessages.path }));
  });
});

describe("channel APIs: query budget", () => {
  /** Statements per request with production flags (one flag read) and capabilities read once. */
  const BUDGET: Record<ChannelOperation, number> = {
    listChannels: 5, listMessages: 6, postMessage: 7, markChannelRead: 8, editMessage: 9, reactToMessage: 10, deleteMessage: 9,
  };

  it.each(Object.entries(BUDGET) as [ChannelOperation, number][])("%s issues at most %i statements", async (operation, budget) => {
    const s = setup();
    s.agree();
    s.database.exec("UPDATE feature_flag SET audience = 'ALL' WHERE key = 'channels'");
    const options = Object.fromEntries(everyRoute(s))[operation];
    const prepare = vi.spyOn(s.d1, "prepare");
    const response = await s.call(operation, { ...options, env: DATABASE_FLAGS });
    expect(response.status).toBeLessThan(300);
    expect(prepare).toHaveBeenCalledTimes(budget);
    expect(budget).toBeLessThanOrEqual(10);
  });

  it("a flagged post or edit costs one statement more, for its moderation event, and stays within 10", async () => {
    const s = setup();
    s.agree();
    s.database.exec("UPDATE feature_flag SET audience = 'ALL' WHERE key = 'channels'");
    const screen = () => ({ reasons: ["Contact details"] });
    const own = s.message("help", { author: VIEWER });
    const prepare = vi.spyOn(s.d1, "prepare");
    expect((await s.call("editMessage", { id: own, body: { body: "Flag me" }, screen, env: DATABASE_FLAGS })).status).toBe(200);
    expect(prepare).toHaveBeenCalledTimes(BUDGET.editMessage + 1);
    prepare.mockClear();
    expect((await s.call("postMessage", { id: s.channel("help"), body: post("Flag me too"), screen, env: DATABASE_FLAGS })).status).toBe(201);
    expect(prepare).toHaveBeenCalledTimes(BUDGET.postMessage + 1);
    expect(Math.max(BUDGET.editMessage, BUDGET.postMessage) + 1).toBeLessThanOrEqual(10);
  });

  it("a thread page and a reply cost one statement more each", async () => {
    const s = setup();
    s.agree();
    s.database.exec("UPDATE feature_flag SET audience = 'ALL' WHERE key = 'channels'");
    const root = s.message("help");
    const prepare = vi.spyOn(s.d1, "prepare");
    await s.call("listMessages", { id: s.channel("help"), query: `?thread=${root}`, env: DATABASE_FLAGS });
    expect(prepare).toHaveBeenCalledTimes(BUDGET.listMessages + 1);
    prepare.mockClear();
    expect((await s.call("postMessage", { id: s.channel("help"), body: post("Reply", root), env: DATABASE_FLAGS })).status).toBe(201);
    expect(prepare).toHaveBeenCalledTimes(BUDGET.postMessage + 1);
  });
});
