import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  env: { DB: {} },
  getChatMessages: vi.fn(),
}));

vi.mock("cloudflare:workers", () => ({ env: mocks.env }));
vi.mock("@/lib/chat/sessions", () => ({
  getChatMessages: mocks.getChatMessages,
}));

import { GET } from "./[id]";

describe("GET /api/chat/sessions/:id", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getChatMessages.mockResolvedValue([
      {
        id: "message-1",
        role: "assistant",
        content: "Answer",
        citations: [],
        createdAt: 10,
      },
    ]);
  });

  it("requires authentication", async () => {
    const response = await GET({
      locals: { user: null },
      params: { id: "session-1" },
    } as unknown as Parameters<typeof GET>[0]);

    expect(response.status).toBe(401);
  });

  it("returns 404 for sessions outside the current user", async () => {
    mocks.getChatMessages.mockResolvedValue(null);

    const response = await GET({
      locals: { user: { id: "user-1" } },
      params: { id: "session-2" },
    } as unknown as Parameters<typeof GET>[0]);

    expect(response.status).toBe(404);
  });

  it("loads messages for the current user's session", async () => {
    const response = await GET({
      locals: { user: { id: "user-1" } },
      params: { id: "session-1" },
    } as unknown as Parameters<typeof GET>[0]);
    const body = (await response.json()) as { messages: unknown[] };

    expect(mocks.getChatMessages).toHaveBeenCalledWith(
      mocks.env.DB,
      "user-1",
      "session-1"
    );
    expect(body.messages).toHaveLength(1);
  });
});
