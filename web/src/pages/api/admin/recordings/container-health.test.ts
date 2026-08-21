import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  containerFetch: vi.fn(),
  containerStart: vi.fn(),
  getByName: vi.fn(),
}));

vi.mock("cloudflare:workers", () => ({
  env: {
    FFMPEG_CONTAINER: { getByName: mocks.getByName },
  },
}));

import { GET } from "./container-health";

function context(isAdmin: boolean) {
  return { locals: { isAdmin } } as never;
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.getByName.mockReturnValue({
    fetch: mocks.containerFetch,
    start: mocks.containerStart,
  });
});

describe("GET /api/admin/recordings/container-health", () => {
  it("rejects an unauthenticated request before touching the container", async () => {
    const response = await GET(context(false));

    expect(response.status).toBe(401);
    expect(mocks.getByName).not.toHaveBeenCalled();
  });

  it("starts the named FFmpeg container and verifies its health payload", async () => {
    mocks.containerFetch.mockResolvedValue(Response.json({ ok: true }));

    const response = await GET(context(true));

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      ok: true,
      service: "ffmpeg-container",
    });
    expect(mocks.getByName).toHaveBeenCalledWith("recording-container-health");
    expect(mocks.containerStart).toHaveBeenCalledBefore(mocks.containerFetch);
    expect(mocks.containerFetch).toHaveBeenCalledWith("https://ffmpeg/health");
  });

  it.each([
    ["non-success response", () => new Response("not ready", { status: 503 })],
    ["invalid payload", () => Response.json({ ok: false })],
  ])("returns 502 for a %s", async (_label, responseFactory) => {
    mocks.containerFetch.mockResolvedValue(responseFactory());

    const response = await GET(context(true));

    expect(response.status).toBe(502);
  });

  it("returns 502 when the container binding cannot start", async () => {
    mocks.containerFetch.mockRejectedValue(new Error("proxy export missing"));

    const response = await GET(context(true));

    expect(response.status).toBe(502);
    await expect(response.json()).resolves.toEqual({
      error: "FFmpeg container could not be reached.",
    });
  });
});
