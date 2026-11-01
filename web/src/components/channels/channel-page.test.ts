import type { AstroGlobal } from "astro";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Channel, ConductAcknowledgement, Me } from "@/lib/platform/contracts";
import { CONDUCT_VERSION } from "@/lib/channels/conduct";
import { AGENT_SESSION_PREFIX } from "@/lib/agent-auth";
import { channels, meByPersona } from "@/lib/platform/fixtures";
import { CONDUCT_INTENT } from "./conduct-flow";

const mocks = vi.hoisted(() => ({
  resolveSpacePage: vi.fn(),
  getRouteChannel: vi.fn(),
  list: vi.fn(),
  load: vi.fn(),
  acknowledge: vi.fn(),
}));
vi.mock("cloudflare:workers", () => ({ env: { DB: "synthetic-d1" } }));
vi.mock("@/components/platform/spaces/space-page", () => ({ resolveSpacePage: mocks.resolveSpacePage }));
vi.mock("@/lib/platform/server/channel-context", () => ({ getRouteChannel: mocks.getRouteChannel }));
vi.mock("./server", () => ({
  channelsServer: () => ({ list: mocks.list, conduct: { load: mocks.load, acknowledge: mocks.acknowledge } }),
}));
import { resolveChannelPage, resolveConductPage } from "./channel-page";

const ORIGIN = "https://ttv.test";
const off = (me: Me): Me => ({ ...me, flags: { ...me.flags, channels: false } });
const agreement: ConductAcknowledgement = { version: CONDUCT_VERSION, acknowledgedAt: 1, current: true };

interface Visit {
  path?: string;
  method?: string;
  agent?: boolean;
  me?: Me;
  channel?: Channel | null;
}

function astro({ path = "/dashboard/community/c/help", method = "GET", agent = false }: Visit = {}): AstroGlobal {
  const url = new URL(path, ORIGIN);
  const request = new Request(url, method === "GET" || method === "HEAD" ? { method } : {
    method, headers: { origin: ORIGIN }, body: new URLSearchParams({ intent: CONDUCT_INTENT, version: String(CONDUCT_VERSION) }),
  });
  const userAgent = agent ? `${AGENT_SESSION_PREFIX}synthetic` : "Mozilla/5.0";
  return {
    url, request, params: { slug: url.pathname.split("/").at(-1) },
    locals: { user: { id: "synthetic" }, session: { userAgent } },
  } as unknown as AstroGlobal;
}

function given({ me = meByPersona.lucy, channel = channels.help }: Visit = {}) {
  mocks.resolveSpacePage.mockResolvedValue({ me, space: "community", page: "communityChannel", onboarding: null });
  mocks.getRouteChannel.mockResolvedValue(channel);
  mocks.list.mockResolvedValue([channels.introductions, channels.help]);
  mocks.load.mockResolvedValue(null);
  mocks.acknowledge.mockResolvedValue(agreement);
}

afterEach(() => {
  for (const mock of Object.values(mocks)) mock.mockReset();
});

async function status(result: unknown): Promise<number | "page"> {
  return result instanceof Response ? result.status : "page";
}

describe("a channel's page", () => {
  it("does not exist while channels is off, and reads nothing", async () => {
    given({ me: off(meByPersona.lucy) });
    expect(await status(await resolveChannelPage(astro(), "community"))).toBe(404);
    expect(await status(await resolveChannelPage(astro({ method: "POST" }), "community"))).toBe(404);
    expect(mocks.list).not.toHaveBeenCalled();
    expect(mocks.getRouteChannel).not.toHaveBeenCalled();
    expect(mocks.acknowledge).not.toHaveBeenCalled();
  });

  it("does not exist without the spaces shell (a personal access token, or spaces off)", async () => {
    given();
    mocks.resolveSpacePage.mockResolvedValue(null);
    expect(await status(await resolveChannelPage(astro(), "community"))).toBe(404);
    expect(mocks.list).not.toHaveBeenCalled();
  });

  it("is the same not-found for a channel the person cannot read, and agreeing through it records nothing", async () => {
    given({ channel: null });
    expect(await status(await resolveChannelPage(astro({ path: "/dashboard/cohort/c/cohort-04" }), "cohort"))).toBe(404);
    expect(await status(await resolveChannelPage(astro({ path: "/dashboard/cohort/c/cohort-04", method: "POST" }), "cohort"))).toBe(404);
    expect(mocks.acknowledge).not.toHaveBeenCalled();
  });

  it("does not open a channel in the other space", async () => {
    given({ channel: channels.cohort04 });
    expect(await status(await resolveChannelPage(astro({ path: "/dashboard/community/c/cohort-04" }), "community"))).toBe(404);
  });

  it("renders a readable channel with the sidebar's list and the person's agreement", async () => {
    given();
    mocks.load.mockResolvedValue(agreement);
    const page = await resolveChannelPage(astro({ path: "/dashboard/community/c/help?message=m1" }), "community");
    expect(page).toMatchObject({
      channel: channels.help, readable: [channels.introductions, channels.help], record: agreement, agreed: true, canAgree: true,
      self: "/dashboard/community/c/help?message=m1",
    });
  });

  it("records a person's agreement and returns them to the page they asked for", async () => {
    given();
    const response = await resolveChannelPage(astro({ path: "/dashboard/community/c/help?message=m1", method: "POST" }), "community");
    expect(response).toBeInstanceOf(Response);
    expect((response as Response).status).toBe(303);
    expect((response as Response).headers.get("Location")).toBe("/dashboard/community/c/help?message=m1");
    expect((response as Response).headers.get("Cache-Control")).toBe("no-store");
    expect(mocks.acknowledge).toHaveBeenCalledExactlyOnceWith(CONDUCT_VERSION);
  });

  it("lets an agent's delegated session read the habits, but never agree for the person", async () => {
    given();
    const read = await resolveChannelPage(astro({ agent: true }), "community");
    expect(read).toMatchObject({ canAgree: false, agreed: false });

    const posted = await resolveChannelPage(astro({ agent: true, method: "POST" }), "community");
    expect(posted).toBeInstanceOf(Response);
    expect((posted as Response).status).toBe(403);
    expect(await (posted as Response).text()).toBe("Only the person can agree to how we talk to each other.");
    expect(mocks.acknowledge).not.toHaveBeenCalled();
  });

  it("refuses other methods, in words", async () => {
    given();
    const response = await resolveChannelPage(astro({ method: "PUT" }), "community");
    expect((response as Response).status).toBe(405);
    expect((response as Response).headers.get("Allow")).toBe("GET, HEAD, POST");
    expect(await (response as Response).text()).toBe("Not allowed.");
    expect(mocks.acknowledge).not.toHaveBeenCalled();
  });
});

describe("the habits page", () => {
  it("is there for anyone with channels on, agreed or not", async () => {
    given();
    expect(await resolveConductPage(astro({ path: "/dashboard/community/conduct" }))).toMatchObject({ agreed: false, canAgree: true });
    expect(mocks.getRouteChannel).not.toHaveBeenCalled();
  });

  it("does not exist while channels is off", async () => {
    given({ me: off(meByPersona.lucy) });
    expect(await status(await resolveConductPage(astro({ path: "/dashboard/community/conduct" })))).toBe(404);
  });

  it("keeps the person on the page after agreeing, and refuses an agent", async () => {
    given();
    const agreed = await resolveConductPage(astro({ path: "/dashboard/community/conduct", method: "POST" }));
    expect((agreed as Response).headers.get("Location")).toBe("/dashboard/community/conduct");
    expect(mocks.acknowledge).toHaveBeenCalledOnce();
    expect(await status(await resolveConductPage(astro({ path: "/dashboard/community/conduct", method: "POST", agent: true })))).toBe(403);
    expect(mocks.acknowledge).toHaveBeenCalledOnce();
  });
});
