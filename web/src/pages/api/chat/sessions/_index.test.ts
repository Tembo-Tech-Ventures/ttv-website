import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  env: { DB: {} },
  capabilities: { cohortIds: ["cohort-1"], teachingCohortIds: [], isAdmin: false },
  listChatSessions: vi.fn(),
}));

vi.mock("cloudflare:workers", () => ({ env: mocks.env }));
vi.mock("@/lib/platform/server/request-capabilities", () => ({ requestCapabilities: vi.fn().mockResolvedValue(mocks.capabilities) }));
vi.mock("@/lib/chat/sessions", () => ({
  listChatSessions: mocks.listChatSessions,
}));

import { GET } from "./index";

describe("GET /api/chat/sessions", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.listChatSessions.mockResolvedValue([
      {
        id: "session-1",
        title: "Mentor hours",
        createdAt: 10,
        updatedAt: 20,
        messageCount: 2,
        latestMessage: "Use interviews.",
      },
    ]);
  });

  it("requires authentication", async () => {
    const response = await GET({
      locals: { user: null },
    } as unknown as Parameters<typeof GET>[0]);

    expect(response.status).toBe(401);
  });

  it("returns sessions for the current user", async () => {
    const response = await GET({
      locals: { user: { id: "user-1" } },
    } as unknown as Parameters<typeof GET>[0]);
    const body = (await response.json()) as { sessions: unknown[] };

    expect(mocks.listChatSessions).toHaveBeenCalledWith(mocks.env.DB, "user-1", mocks.capabilities);
    expect(body.sessions).toHaveLength(1);
  });
});
