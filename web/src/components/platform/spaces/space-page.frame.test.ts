import { afterEach, describe, expect, it, vi } from "vitest";
import { meByPersona } from "@/lib/platform/fixtures";
import { withRequestScope } from "@/lib/platform/server/request-scope";

const mocks = vi.hoisted(() => ({
  getSpaceContext: vi.fn(), getOnboardingState: vi.fn(), journey: vi.fn(), list: vi.fn(), navCounts: vi.fn(),
  getFlags: vi.fn(), capabilities: vi.fn(),
}));
vi.mock("cloudflare:workers", () => ({ env: { DB: "synthetic-d1" } }));
vi.mock("@/lib/platform/server/space-context", () => ({ getSpaceContext: mocks.getSpaceContext }));
vi.mock("@/lib/onboarding/service", () => ({ getOnboardingState: mocks.getOnboardingState }));
vi.mock("@/lib/observability/errors", () => ({ recordError: vi.fn() }));
vi.mock("@/lib/student/journey", () => ({ getStudentJourney: mocks.journey }));
vi.mock("@/components/channels/server", () => ({ channelsServer: () => ({ list: mocks.list }) }));
vi.mock("@/components/admin/admin-nav-server", () => ({ startAdminNavCounts: mocks.navCounts }));
vi.mock("@/lib/platform/server/flags", () => ({ getFlags: mocks.getFlags }));
vi.mock("@/lib/platform/server/request-capabilities", () => ({ requestCapabilities: mocks.capabilities }));
import { resolveSpacePage, resolveSpacePageWith, startAdminSpacePage } from "./space-page";

const lucy = meByPersona.lucy;
const amina = meByPersona.amina;
const locals = (overrides: Partial<App.Locals> = {}) => ({ user: { id: lucy.user.id }, ...overrides }) as unknown as App.Locals;
const settle = () => new Promise((resolve) => { setImmediate(resolve); });

afterEach(() => vi.resetAllMocks());

describe("the frame's reads start with the space (PERF-2)", () => {
  it("in a GET, beside onboarding, once the page has a context", async () => {
    mocks.getSpaceContext.mockResolvedValue(lucy);
    mocks.journey.mockResolvedValue({});
    mocks.list.mockResolvedValue([]);
    mocks.getOnboardingState.mockReturnValue(new Promise(() => {}));
    void withRequestScope("GET", () => resolveSpacePage(locals(), "journey"));
    await settle();
    // Onboarding has not answered, yet the journey and the sidebar's channels are already being read.
    expect(mocks.journey).toHaveBeenCalledOnce();
    expect(mocks.journey.mock.calls[0]![1]).toBe(lucy.user.id);
    expect(mocks.list).toHaveBeenCalledOnce();
  });

  it("not in a POST, whose page reads them after its own writes", async () => {
    mocks.getSpaceContext.mockResolvedValue(lucy);
    await withRequestScope("POST", () => resolveSpacePage(locals(), "journey"));
    expect(mocks.journey).not.toHaveBeenCalled();
    expect(mocks.list).not.toHaveBeenCalled();
  });

  it.each([
    ["the context is refused", () => mocks.getSpaceContext.mockRejectedValue(new Response(null, { status: 404 }))],
    ["the space is not the person's", () => mocks.getSpaceContext.mockResolvedValue(lucy)],
  ])("not when %s", async (_, arrange) => {
    arrange();
    const load = vi.fn();
    expect(await withRequestScope("GET", () => resolveSpacePageWith(locals(), "adminUsers", load))).toBeNull();
    expect(load).not.toHaveBeenCalled();
    expect(mocks.journey).not.toHaveBeenCalled();
  });

  it("without the sidebar's channels while `channels` is off", async () => {
    mocks.getSpaceContext.mockResolvedValue({ ...lucy, flags: { ...lucy.flags, channels: false } });
    mocks.journey.mockResolvedValue({});
    mocks.getOnboardingState.mockResolvedValue({ stage: "DONE", intents: [], inferred: [], roles: [], requests: [] });
    await withRequestScope("GET", () => resolveSpacePage(locals(), "journey"));
    expect(mocks.journey).toHaveBeenCalledOnce();
    expect(mocks.list).not.toHaveBeenCalled();
  });
});

describe("resolveSpacePageWith", () => {
  it("runs the page's reads with `me`, beside onboarding, and returns both", async () => {
    mocks.getSpaceContext.mockResolvedValue(lucy);
    mocks.getOnboardingState.mockResolvedValue({ stage: "DONE", intents: [], inferred: [], roles: [], requests: [] });
    const resolved = await resolveSpacePageWith(locals(), "journey", async (me) => me.user.id);
    expect(resolved?.[0]).toMatchObject({ me: lucy, space: "community", page: "journey" });
    expect(resolved?.[1]).toBe(lucy.user.id);
  });

  it("lets the page's read errors reach the page", async () => {
    mocks.getSpaceContext.mockResolvedValue(lucy);
    await expect(resolveSpacePageWith(locals(), "mentors", async () => { throw new Error("D1 unavailable"); })).rejects.toThrow("D1 unavailable");
  });
});

describe("startAdminSpacePage", () => {
  const adminLocals = () => locals({ user: { id: amina.user.id }, isAdmin: true } as Partial<App.Locals>);
  const capabilities = { ...amina.capabilities, spaces: amina.spaces, teachingCohortIds: [] };

  it("starts the Admin space's context and frame once flags and capabilities are known", async () => {
    mocks.getSpaceContext.mockReturnValue(new Promise(() => {}));
    mocks.getFlags.mockResolvedValue(amina.flags);
    mocks.capabilities.mockResolvedValue(capabilities);
    mocks.journey.mockResolvedValue({});
    await withRequestScope("GET", async () => { startAdminSpacePage(adminLocals()); await settle(); });
    expect(mocks.getSpaceContext).toHaveBeenCalledOnce();
    expect(mocks.getFlags.mock.calls[0]![0]).toMatchObject({ isAdmin: true, user: { id: amina.user.id } });
    expect(mocks.journey).toHaveBeenCalledOnce();
    expect(mocks.navCounts).toHaveBeenCalledWith(expect.objectContaining({ user: { id: amina.user.id }, flags: amina.flags }));
  });

  it.each([
    ["spaces is off for them", { ...amina.flags, spaces: false }, capabilities],
    ["they cannot open Admin", amina.flags, { ...capabilities, spaces: ["community", "profile"] }],
  ])("starts no frame when %s", async (_, flags, caps) => {
    mocks.getSpaceContext.mockReturnValue(new Promise(() => {}));
    mocks.getFlags.mockResolvedValue(flags);
    mocks.capabilities.mockResolvedValue(caps);
    await withRequestScope("GET", async () => { startAdminSpacePage(adminLocals()); await settle(); });
    expect(mocks.journey).not.toHaveBeenCalled();
    expect(mocks.navCounts).not.toHaveBeenCalled();
  });

  it.each([
    ["outside a read-only request", "POST", {}],
    ["for a personal access token", "GET", { personalAccessToken: { id: "pat", scopes: ["admin:read"] } }],
    ["signed out", "GET", { user: null }],
  ])("reads nothing %s", async (_, method, overrides) => {
    await withRequestScope(method, async () => { startAdminSpacePage(locals(overrides as Partial<App.Locals>)); await settle(); });
    expect(mocks.getSpaceContext).not.toHaveBeenCalled();
    expect(mocks.getFlags).not.toHaveBeenCalled();
  });

  it("never lets a failed read escape", async () => {
    mocks.getSpaceContext.mockRejectedValue(new Error("D1 unavailable"));
    mocks.getFlags.mockRejectedValue(new Error("D1 unavailable"));
    mocks.capabilities.mockResolvedValue(capabilities);
    await withRequestScope("GET", async () => { startAdminSpacePage(adminLocals()); await settle(); });
    expect(mocks.journey).not.toHaveBeenCalled();
  });
});
