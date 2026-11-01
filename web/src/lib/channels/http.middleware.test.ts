import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { APIContext } from "astro";
import { ChannelList, ChannelShareables, ErrorEnvelope, Message } from "@/lib/platform/contracts";
import { channelDatabase, ORIGIN, post, VIEWER, type ChannelFixture } from "./test-support";

const mocks = vi.hoisted(() => ({
  env: {} as Record<string, unknown>, getSession: vi.fn(), authenticatePersonalAccessToken: vi.fn(),
}));
vi.mock("cloudflare:workers", () => ({ env: mocks.env }));
vi.mock("astro:middleware", () => ({ defineMiddleware: (handler: unknown) => handler }));
vi.mock("@/lib/auth", () => ({ createAuth: () => ({ api: { getSession: mocks.getSession } }) }));
vi.mock("@/lib/personal-access-tokens", async (importOriginal) => ({
  ...await importOriginal<typeof import("@/lib/personal-access-tokens")>(),
  authenticatePersonalAccessToken: mocks.authenticatePersonalAccessToken,
}));
vi.mock("@/lib/observability/errors", async (importOriginal) => ({
  ...await importOriginal<typeof import("@/lib/observability/errors")>(),
  recordErrorInBackground: vi.fn(),
}));
import { onRequest } from "@/middleware";
import { getRouteChannelPage, getRouteChannelShareables } from "@/lib/platform/server/channel-context";
import { GET as listChannels } from "@/pages/api/channels/index";
import { GET as listMessages, POST as postMessage } from "@/pages/api/channels/[id]/messages";
import { POST as markRead } from "@/pages/api/channels/[id]/read";
import { GET as listShareables } from "@/pages/api/channels/[id]/shareables";
import { DELETE as deleteMessage, PATCH as editMessage } from "@/pages/api/messages/[id]";
import { POST as react } from "@/pages/api/messages/[id]/reactions";

let s: ChannelFixture;
const session = (userId = VIEWER) => ({
  user: { id: userId, name: "Wanjiku Njeri", email: `${userId}@example.test`, image: null },
  session: { id: `${userId}-session`, userId, userAgent: "Mozilla/5.0" },
});
beforeEach(() => {
  vi.clearAllMocks();
  s = channelDatabase();
  s.agree();
  s.database.exec("UPDATE feature_flag SET audience = 'ALL' WHERE key IN ('spaces', 'channels')");
  Object.assign(mocks.env, { DB: s.d1, DEPLOYMENT_ENVIRONMENT: "production", PLATFORM_FLAGS_OVERRIDE: undefined });
  mocks.getSession.mockResolvedValue(session());
  mocks.authenticatePersonalAccessToken.mockResolvedValue(null);
});
afterEach(() => { s.database.close(); vi.restoreAllMocks(); });

type Handler = (context: APIContext) => Response | Promise<Response>;
async function call(path: string, handler: Handler, options: { method?: string; body?: unknown; params?: Record<string, string>; scopes?: string[] } = {}) {
  const url = new URL(path, ORIGIN);
  const headers = new Headers({ Origin: ORIGIN });
  if (options.scopes) {
    headers.set("Authorization", `Bearer ttv_pat_${"1".repeat(64)}`);
    mocks.authenticatePersonalAccessToken.mockResolvedValue({ ...session(), token: { id: "synthetic-pat", scopes: options.scopes } });
  }
  const request = new Request(url, { method: options.method ?? "GET", headers, body: options.body === undefined ? undefined : JSON.stringify(options.body) });
  const ctx = { url, request, params: options.params ?? {}, locals: {},
    redirect: (location: string, status = 302) => new Response(null, { status, headers: { location } }),
  } as unknown as APIContext;
  const response = await onRequest(ctx, async () => handler(ctx));
  if (!(response instanceof Response)) throw new Error("Expected a response");
  return response;
}

describe("channel API route files through the middleware", () => {
  it("serve every route to a signed-in browser session", async () => {
    const help = s.channel("help");
    const listed = await call("/api/channels", listChannels);
    expect(ChannelList.parse(await listed.json()).items.some((channel) => channel.id === help)).toBe(true);
    expect((await call(`/api/channels/${help}/messages`, listMessages, { params: { id: help } })).status).toBe(200);
    const shareables = await call(`/api/channels/${help}/shareables?q=retries`, listShareables, { params: { id: help } });
    expect(ChannelShareables.parse(await shareables.json())).toEqual({ projects: [], clips: [] });
    const created = await call(`/api/channels/${help}/messages`, postMessage, { method: "POST", params: { id: help }, body: post("Habari") });
    expect(created.status).toBe(201);
    const { id } = Message.parse(await created.json());
    const steps: [string, Handler, string, unknown][] = [
      [`/api/channels/${help}/read`, markRead, "POST", { messageId: id }],
      [`/api/messages/${id}`, editMessage, "PATCH", { body: "Habari yako" }],
      [`/api/messages/${id}/reactions`, react, "POST", { kind: "thanks", active: true }],
      [`/api/messages/${id}`, deleteMessage, "DELETE", undefined],
    ];
    for (const [path, handler, method, body] of steps) {
      const response = await call(path, handler, { method, body, params: { id: path.includes("/channels/") ? help : id } });
      expect(response.status, `${method} ${path}`).toBe(200);
    }
  });

  it("refuse personal access tokens: community tokens at the middleware, admin tokens in the handler", async () => {
    const community = await call("/api/channels", listChannels, { scopes: ["community:read"] });
    expect(community.status).toBe(403);
    const help = s.channel("help");
    const shareables = await call(`/api/channels/${help}/shareables`, listShareables, { params: { id: help }, scopes: ["admin:read"] });
    expect([shareables.status, ErrorEnvelope.parse(await shareables.json()).error.code]).toEqual([403, "forbidden"]);
    const admin = await call("/api/channels", listChannels, { scopes: ["admin:read"] });
    expect([admin.status, ErrorEnvelope.parse(await admin.json()).error.code]).toEqual([403, "forbidden"]);
  });

  it("are 404 signed out", async () => {
    mocks.getSession.mockResolvedValue(null);
    expect((await call("/api/channels", listChannels)).status).toBe(404);
  });

  it("let a channel page read capabilities once, for the router and the frontmatter alike", async () => {
    const help = s.channel("help");
    s.message("help");
    const prepare = vi.spyOn(s.d1, "prepare");
    let page: Awaited<ReturnType<typeof getRouteChannelPage>> = null;
    const response = await call("/dashboard/community/c/help?thread=nope", async (ctx) => {
      page = await getRouteChannelPage(ctx);
      return new Response("Channel page");
    });
    expect(response.status).toBe(200);
    expect(page).toMatchObject({ channel: { id: help }, page: { thread: null, read: { lastReadMessageId: null, unreadCount: 1 } } });
    const capabilityReads = prepare.mock.calls.filter(([query]) => /from "programRole"/.test(query));
    expect(capabilityReads).toHaveLength(1);
    expect(s.database.prepare("SELECT COUNT(*) AS n FROM channel_read").get()).toEqual({ n: 0 });
  });

  it("give a channel page its attach tools: the caller's projects where they can post, none where they cannot", async () => {
    s.database.exec(`INSERT INTO communityJourney (id, userId, title, description, occurredAt, visibility) VALUES
      ('ledger', '${VIEWER}', 'Ledger', 'A ledger', '2026-10-01', 'institution')`);
    const shareablesAt = async (path: string) => {
      let shareables: Awaited<ReturnType<typeof getRouteChannelShareables>> = null;
      const response = await call(path, async (ctx) => {
        shareables = await getRouteChannelShareables(ctx);
        return new Response("Channel page");
      });
      expect(response.status).toBe(200);
      return shareables as Awaited<ReturnType<typeof getRouteChannelShareables>>;
    };
    expect((await shareablesAt("/dashboard/community/c/help"))?.projects.map((project) => project.journeyId)).toEqual(["ledger"]);
    expect((await shareablesAt("/dashboard/community/c/help"))?.clips).toEqual([]);
    s.database.exec("UPDATE channel SET archivedAt = 1 WHERE slug = 'help'");
    expect(await shareablesAt("/dashboard/community/c/help")).toBeNull();
  });
});
