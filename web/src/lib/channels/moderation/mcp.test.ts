import { afterEach, describe, expect, it, vi } from "vitest";
import { handleCommunityMcp, type CommunityMcpService } from "@/lib/community/mcp";
import { Message, ModerationQueue } from "@/lib/platform/contracts";
import type { CapabilityCase } from "@/lib/platform/server/capabilities.fixtures";
import { channelDatabase, ORIGIN, VIEWER, type ChannelFixture } from "../test-support";
import { moderationMcpTools } from "./mcp";

const fixtures: ChannelFixture[] = [];
afterEach(() => { fixtures.splice(0).forEach(({ database }) => database.close()); vi.restoreAllMocks(); });
function setup(fixture: Partial<CapabilityCase> = { globalRoles: ["ADMIN"] }) {
  const s = channelDatabase(fixture);
  fixtures.push(s);
  return s;
}
const OTIENO = "synthetic-otieno";
const READ = ["admin:read"];
const WRITE = ["admin:read", "admin:write"];
/** The community tools never run here: the caller holds no community scope. */
const community: CommunityMcpService = {
  getOwnProfile: vi.fn(), updateOwnProfile: vi.fn(), searchProfiles: vi.fn(), getProfile: vi.fn(), listJourney: vi.fn(),
  access: vi.fn(async () => ({ isInstitution: false })),
};

interface Rpc {
  result?: { tools?: { name: string }[]; isError?: boolean; content?: { text: string }[]; structuredContent?: { result: unknown } };
  error?: { code: number; message: string };
}
/** One JSON-RPC call to /api/mcp as the caller: with a token of these scopes, or (null) a same-origin browser session. */
async function rpc(s: ChannelFixture, scopes: string[] | null, method: string, params?: unknown, options: { flags?: "all" } = { flags: "all" }) {
  const headers = new Headers({ "Content-Type": "application/json" });
  if (scopes === null) headers.set("Origin", ORIGIN);
  const request = new Request(`${ORIGIN}/api/mcp`, { method: "POST", headers, body: JSON.stringify({ jsonrpc: "2.0", id: 7, method, params }) });
  // The preview override turns every flag on; without it, production reads them from the database.
  const env = options.flags ? { DEPLOYMENT_ENVIRONMENT: undefined, PLATFORM_FLAGS_OVERRIDE: options.flags }
    : { DEPLOYMENT_ENVIRONMENT: "production", PLATFORM_FLAGS_OVERRIDE: undefined };
  const tools = moderationMcpTools({ db: s.d1, env, locals: { user: { id: VIEWER } } as never, scopes });
  const response = await handleCommunityMcp(request, { userId: VIEWER, scopes }, community, undefined, [tools]);
  return await response.json() as Rpc;
}
const listed = async (...args: Parameters<typeof rpc>) => (await rpc(...args)).result?.tools?.map((tool) => tool.name);
const call = (s: ChannelFixture, scopes: string[] | null, name: string, args: unknown) => rpc(s, scopes, "tools/call", { name, arguments: args });

describe("moderation MCP tools: who sees them", () => {
  it("lists the queue for admin:read and decisions for admin:write, to admins and their browser sessions", async () => {
    const s = setup();
    expect(await listed(s, READ, "tools/list")).toEqual(["list_moderation_queue"]);
    expect(await listed(s, WRITE, "tools/list")).toEqual(["list_moderation_queue", "moderate_message"]);
    expect(await listed(s, null, "tools/list")).toEqual(expect.arrayContaining(["list_moderation_queue", "moderate_message"]));
  });

  it("lists neither to channels or community tokens, to a non-admin's admin token, or while channels is off", async () => {
    const s = setup();
    expect(await listed(s, ["channels:read", "channels:write"], "tools/list")).toEqual([]);
    expect(await listed(s, ["community:read"], "tools/list")).not.toContain("list_moderation_queue");
    s.database.exec("UPDATE feature_flag SET audience = 'OFF' WHERE key = 'channels'");
    expect(await listed(s, WRITE, "tools/list", undefined, {})).toEqual([]);
    const member = setup({});
    expect(await listed(member, WRITE, "tools/list")).toEqual([]);
  });
});

describe("moderation MCP tools: calls", () => {
  it("list the queue as the API does, evidence included, refusing a cursor it did not issue", async () => {
    const s = setup();
    const id = s.message("help", { author: OTIENO, state: "FLAGGED", body: "Ring me: 0712 345 678" });
    s.database.prepare(`INSERT INTO moderation_event (id, messageId, action, source, actorId, fromState, toState, reasons, createdAt)
      VALUES ('event', ?, 'FLAG', 'DETECTOR', NULL, 'VISIBLE', 'FLAGGED', '["Contact details"]', 5)`).run(id);
    const result = await call(s, READ, "list_moderation_queue", {});
    const queue = ModerationQueue.parse(result.result?.structuredContent?.result);
    expect(queue.items.map((item) => [item.id, item.state, item.evidence.map((version) => version.body)]))
      .toEqual([[id, "PENDING", ["Ring me: 0712 345 678"]]]);
    expect(JSON.parse(result.result?.content?.[0]?.text ?? "null")).toEqual(result.result?.structuredContent?.result);
    expect(ModerationQueue.parse((await call(s, READ, "list_moderation_queue", { state: "DECIDED" })).result?.structuredContent?.result).items)
      .toEqual([]);
    expect(await call(s, READ, "list_moderation_queue", { cursor: "not-a-cursor" }))
      .toMatchObject({ result: { isError: true, content: [{ text: "Invalid moderation queue cursor." }] } });
  });

  it("decide as the API does, and refuse what it refuses, in its words", async () => {
    const s = setup();
    const id = s.message("help", { author: OTIENO, body: "Harsh words" });
    const hidden = await call(s, WRITE, "moderate_message", { messageId: id, action: "hide", reason: "Harsh, not about the work" });
    expect(Message.parse(hidden.result?.structuredContent?.result).moderation?.state).toBe("HIDDEN");
    expect(s.database.prepare("SELECT state, decision, decidedBy FROM moderation_case").get())
      .toEqual({ state: "DECIDED", decision: "HIDE", decidedBy: VIEWER });
    expect(await call(s, WRITE, "moderate_message", { messageId: id, action: "keep", reason: "Fine" }))
      .toMatchObject({ result: { isError: true, content: [{ text: "This message is hidden. Restore it instead." }] } });
    expect(await call(s, WRITE, "moderate_message", { messageId: "0".repeat(32), action: "restore", reason: "Fine" }))
      .toMatchObject({ result: { isError: true, content: [{ text: "Message not found." }] } });
  });

  it("refuse a missing scope, invalid arguments, a non-admin and a flag that is off, writing nothing", async () => {
    const s = setup();
    const id = s.message("help", { author: OTIENO, body: "Harsh words" });
    const decide = { messageId: id, action: "hide", reason: "Harsh" };
    expect((await call(s, READ, "moderate_message", decide)).error).toEqual({ code: -32003, message: "Insufficient token scope" });
    expect((await call(s, ["community:read"], "list_moderation_queue", {})).error).toEqual({ code: -32003, message: "Insufficient token scope" });
    for (const args of [{ ...decide, action: "delete" }, { ...decide, reason: " " }, { ...decide, extra: 1 }, { state: "OPEN" }]) {
      const name = "state" in args ? "list_moderation_queue" : "moderate_message";
      expect((await call(s, WRITE, name, args)).error, `${JSON.stringify(args)}`).toEqual({ code: -32602, message: "Invalid tool arguments" });
    }
    const member = setup({});
    member.message("help", { author: OTIENO });
    expect((await call(member, WRITE, "list_moderation_queue", {})).error).toEqual({ code: -32602, message: "Invalid tool parameters" });
    s.database.exec("UPDATE feature_flag SET audience = 'OFF' WHERE key = 'channels'");
    expect((await rpc(s, WRITE, "tools/call", { name: "moderate_message", arguments: decide }, {})).error)
      .toEqual({ code: -32602, message: "Invalid tool parameters" });
    expect(s.database.prepare("SELECT COUNT(*) AS n FROM moderation_event").get()).toEqual({ n: 0 });
  });

  it("answer an unexpected failure with the generic tool error", async () => {
    const s = setup();
    vi.spyOn(s.d1, "prepare").mockImplementation(() => { throw new Error("D1 is down"); });
    expect(await call(s, WRITE, "list_moderation_queue", {}))
      .toMatchObject({ result: { isError: true, content: [{ text: "Tool could not complete; access or input may be invalid." }] } });
  });
});
