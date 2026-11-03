import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  countPendingAccessRequests: vi.fn(),
  countPendingModeration: vi.fn(),
  countOpenChecks: vi.fn(),
  isFlagEnabled: vi.fn(),
  recordError: vi.fn(),
}));
vi.mock("cloudflare:workers", () => ({ env: { DB: "synthetic-d1", DEPLOYMENT_ENVIRONMENT: "production" } }));
vi.mock("@/lib/admin/access-requests", () => ({ countPendingAccessRequests: mocks.countPendingAccessRequests }));
vi.mock("@/lib/channels/moderation/queue", () => ({ countPendingModeration: mocks.countPendingModeration }));
vi.mock("@/lib/mentoring/checks", () => ({ countOpenChecks: mocks.countOpenChecks }));
vi.mock("@/lib/platform/server/flags", () => ({ isFlagEnabled: mocks.isFlagEnabled }));
vi.mock("@/lib/observability/errors", () => ({ recordError: mocks.recordError }));
const { loadAdminNavFacts } = await import("./admin-nav-server");

const locals = { user: { id: "admin-1" } } as unknown as App.Locals;
const ORIGIN = "https://tembotechventures.com";

beforeEach(() => {
  vi.resetAllMocks();
  mocks.countPendingAccessRequests.mockResolvedValue(7);
  mocks.countPendingModeration.mockResolvedValue(9);
  mocks.countOpenChecks.mockResolvedValue(1);
  mocks.isFlagEnabled.mockResolvedValue(true);
});

describe("loadAdminNavFacts", () => {
  it("counts the queues, with the request notes on the Moderation badge and separately for the existing shell", async () => {
    await expect(loadAdminNavFacts(locals, ORIGIN)).resolves.toMatchObject({
      pendingAccessRequests: 7, pendingModeration: 10, pendingCases: 9, pendingRequestNotes: 1,
    });
  });

  it("lists no Moderation entry while channels are off, and reads no queue for it", async () => {
    mocks.isFlagEnabled.mockResolvedValue(false);
    await expect(loadAdminNavFacts(locals, ORIGIN)).resolves.toMatchObject({ pendingModeration: null, pendingCases: null, pendingRequestNotes: 0 });
    expect(mocks.countPendingModeration).not.toHaveBeenCalled();
  });

  it("reuses the counts the page already holds", async () => {
    await loadAdminNavFacts(locals, ORIGIN, { pendingAccessRequests: 2, pendingModeration: 3, pendingRequestNotes: 0 });
    expect(mocks.countPendingAccessRequests).not.toHaveBeenCalled();
    expect(mocks.countPendingModeration).not.toHaveBeenCalled();
    expect(mocks.countOpenChecks).not.toHaveBeenCalled();
  });

  it("never takes its page down: a failed read lists the entries bare and is recorded", async () => {
    const failure = new Error("moderation_case unavailable");
    mocks.countPendingModeration.mockRejectedValue(failure);
    await expect(loadAdminNavFacts(locals, ORIGIN)).resolves.toMatchObject({
      pendingAccessRequests: 0, pendingModeration: null, pendingCases: null, pendingRequestNotes: 0, dataMigrationEnabled: false,
    });
    expect(mocks.recordError).toHaveBeenCalledWith("synthetic-d1", expect.objectContaining({ error: failure, level: "warning" }));
  });
});
