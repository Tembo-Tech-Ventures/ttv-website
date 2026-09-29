import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  recordErrorInBackground: vi.fn(),
}));

vi.mock("@/lib/observability/errors", () => ({
  recordErrorInBackground: mocks.recordErrorInBackground,
}));

import {
  loadPublicPageData,
  markPublicDataUnavailable,
} from "./public-page-data";

const db = {} as D1Database;
const waitUntil = { waitUntil: vi.fn() } as unknown as ExecutionContext;

beforeEach(() => vi.clearAllMocks());

describe("public page D1 reads", () => {
  it("marks required public data as retryable instead of a generic 500", () => {
    const response = { status: 200, headers: new Headers() };

    markPublicDataUnavailable(response);

    expect(response.status).toBe(503);
    expect(response.headers.get("Retry-After")).toBe("30");
    expect(response.headers.get("Cache-Control")).toBe("no-store");
  });

  it("returns successful data without recording an error", async () => {
    await expect(
      loadPublicPageData({
        db,
        fallback: [],
        load: async () => ["post"],
        route: "/",
        version: "version-1",
        waitUntil,
      })
    ).resolves.toEqual({ available: true, data: ["post"] });
    expect(mocks.recordErrorInBackground).not.toHaveBeenCalled();
  });

  it("reproduces the production overload and returns the explicit fallback", async () => {
    const privateBoundValue = "private-profile-handle";
    const failure = new Error(
      `Failed query with params: ${privateBoundValue}`,
      {
        cause: new Error(
          "D1_ERROR: D1 DB is overloaded. Requests queued for too long."
        ),
      }
    );

    await expect(
      loadPublicPageData({
        db,
        fallback: { profile: undefined },
        load: async () => {
          throw failure;
        },
        route: "/talent/:handle",
        version: "version-1",
        waitUntil,
      })
    ).resolves.toEqual({
      available: false,
      data: { profile: undefined },
    });

    expect(mocks.recordErrorInBackground).toHaveBeenCalledWith(
      waitUntil,
      db,
      {
        source: "request",
        route: "/talent/:handle",
        error: expect.objectContaining({
          message:
            "Public page database read unavailable: D1_ERROR: D1 DB is overloaded. Requests queued for too long.",
        }),
        version: "version-1",
      }
    );
    expect(JSON.stringify(mocks.recordErrorInBackground.mock.calls)).not.toContain(
      privateBoundValue
    );
  });

  it("rethrows an unrelated failure for the request error boundary", async () => {
    const failure = new Error("D1_ERROR: no such table");

    await expect(
      loadPublicPageData({
        db,
        fallback: [],
        load: async () => {
          throw failure;
        },
        route: "/",
      })
    ).rejects.toBe(failure);
    expect(mocks.recordErrorInBackground).not.toHaveBeenCalled();
  });
});
