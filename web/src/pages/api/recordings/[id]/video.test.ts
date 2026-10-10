import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  env: {
    DB: {} as Record<string, unknown>,
    BUCKET: {
      head: vi.fn(),
      get: vi.fn(),
    },
  },
  drizzle: vi.fn(),
  userCanAccessProgram: vi.fn(),
}));

vi.mock("cloudflare:workers", () => ({ env: mocks.env }));
vi.mock("drizzle-orm/d1", () => ({ drizzle: mocks.drizzle }));
vi.mock("@/lib/recordings/access", () => ({
  userCanAccessProgram: mocks.userCanAccessProgram,
}));

import { GET } from "./video";

function createDatabase(recording: Record<string, unknown> | undefined) {
  return {
    query: {
      recording: {
        findFirst: vi.fn().mockResolvedValue(recording),
      },
    },
  };
}

function context({
  user = { id: "user-1" },
  isAdmin = false,
}: {
  user?: Record<string, unknown> | null;
  isAdmin?: boolean;
} = {}) {
  return {
    params: { id: "recording-1" },
    request: new Request("https://example.com/api/recordings/recording-1/video"),
    locals: { user, isAdmin },
  } as unknown as Parameters<typeof GET>[0];
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.drizzle.mockReturnValue(
    createDatabase({
      id: "recording-1",
      programId: "program-audit",
      r2VideoKey: "recordings/video.mp4",
    })
  );
  mocks.env.BUCKET.head.mockResolvedValue({ size: 5 });
  mocks.env.BUCKET.get.mockResolvedValue({
    body: "video",
    httpMetadata: { contentType: "video/mp4" },
  });
});

describe("GET /api/recordings/[id]/video", () => {
  it("returns 401 before looking up a recording when the user is signed out", async () => {
    const response = await GET(context({ user: null }));

    expect(response.status).toBe(401);
    expect(mocks.drizzle).not.toHaveBeenCalled();
    expect(mocks.userCanAccessProgram).not.toHaveBeenCalled();
  });

  it("returns 403 when the shared cohort access helper denies the program", async () => {
    mocks.userCanAccessProgram.mockResolvedValue(false);

    const response = await GET(context());

    expect(response.status).toBe(403);
    expect(mocks.userCanAccessProgram).toHaveBeenCalledWith(
      expect.anything(),
      "user-1",
      "program-audit"
    );
    expect(mocks.env.BUCKET.head).not.toHaveBeenCalled();
  });

  it("streams a recording when the shared cohort access helper grants the program", async () => {
    mocks.userCanAccessProgram.mockResolvedValue(true);

    const response = await GET(context());

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("video/mp4");
    await expect(response.text()).resolves.toBe("video");
    expect(mocks.userCanAccessProgram).toHaveBeenCalledWith(
      expect.anything(),
      "user-1",
      "program-audit"
    );
  });
});
