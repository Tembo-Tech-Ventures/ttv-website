import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  checkHealth: vi.fn(),
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
    checkHealth: mocks.checkHealth,
  });
});

describe("GET /api/admin/recordings/container-health", () => {
  it("rejects an unauthenticated request before touching the container", async () => {
    const response = await GET(context(false));

    expect(response.status).toBe(401);
    expect(mocks.getByName).not.toHaveBeenCalled();
  });

  it("verifies the named FFmpeg container health payload", async () => {
    mocks.checkHealth.mockResolvedValue({
      ok: true,
      status: 200,
      text: JSON.stringify({ ok: true }),
    });

    const response = await GET(context(true));

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      ok: true,
      service: "ffmpeg-container",
    });
    expect(mocks.getByName).toHaveBeenCalledWith("recording-container-health");
    expect(mocks.checkHealth).toHaveBeenCalledOnce();
  });

  it.each([
    [
      "non-success response",
      () => ({ ok: false, status: 503, text: "not ready" }),
    ],
    [
      "invalid payload",
      () => ({ ok: true, status: 200, text: JSON.stringify({ ok: false }) }),
    ],
  ])("returns 502 for a %s", async (_label, responseFactory) => {
    mocks.checkHealth.mockResolvedValue(responseFactory());

    const response = await GET(context(true));

    expect(response.status).toBe(502);
  });

  it("returns 502 when the container binding cannot start", async () => {
    mocks.checkHealth.mockRejectedValue(new Error("proxy export missing"));

    const response = await GET(context(true));

    expect(response.status).toBe(502);
    await expect(response.json()).resolves.toEqual({
      error: "FFmpeg container could not be reached.",
    });
  });
});
