import { describe, expect, it, vi } from "vitest";
import { CONDUCT_VERSION } from "@/lib/channels/conduct";
import { CONDUCT_INTENT, conductAgreed, handleConductPost, type ConductActions } from "./conduct-flow";

const ORIGIN = "https://ttv.test";
const PAGE = `${ORIGIN}/dashboard/community/c/help?message=m1`;

function post(fields: Record<string, string>, headers: Record<string, string> = { origin: ORIGIN }): Request {
  return new Request(PAGE, { method: "POST", headers, body: new URLSearchParams(fields) });
}

function actions(): ConductActions & { acknowledge: ReturnType<typeof vi.fn> } {
  return { load: vi.fn(async () => null), acknowledge: vi.fn(async () => {}) };
}

const agree = { intent: CONDUCT_INTENT, version: String(CONDUCT_VERSION) };

describe("agreeing to how we talk to each other", () => {
  it("records the current version and returns the person to the page they asked for", async () => {
    const backend = actions();
    expect(await handleConductPost(post(agree), backend, "/dashboard/community/c/help?message=m1"))
      .toEqual({ kind: "redirect", location: "/dashboard/community/c/help?message=m1" });
    expect(backend.acknowledge).toHaveBeenCalledExactlyOnceWith(CONDUCT_VERSION);
  });

  it("leaves reads alone", async () => {
    const backend = actions();
    expect(await handleConductPost(new Request(PAGE), backend, "/back")).toBeNull();
    expect(backend.acknowledge).not.toHaveBeenCalled();
  });

  it("refuses a post from another site, or with no origin at all", async () => {
    for (const headers of [{ origin: "https://elsewhere.test" }, {} as Record<string, string>]) {
      const backend = actions();
      expect(await handleConductPost(post(agree, headers), backend, "/back")).toEqual({ kind: "refuse", status: 403 });
      expect(backend.acknowledge).not.toHaveBeenCalled();
    }
  });

  it("refuses a post that is not this form", async () => {
    const backend = actions();
    expect(await handleConductPost(post({ intent: "intents", version: "1" }), backend, "/back")).toEqual({ kind: "refuse", status: 400 });
    expect(backend.acknowledge).not.toHaveBeenCalled();
  });

  it("refuses a body far larger than the form", async () => {
    const backend = actions();
    const huge = post({ ...agree, padding: "x".repeat(40 * 1024) });
    expect(await handleConductPost(huge, backend, "/back")).toEqual({ kind: "refuse", status: 413 });
    expect(backend.acknowledge).not.toHaveBeenCalled();
  });

  it("records nothing for words the person did not read, and shows them the current ones", async () => {
    for (const version of [String(CONDUCT_VERSION - 1), String(CONDUCT_VERSION + 1), "", "one"]) {
      const backend = actions();
      expect(await handleConductPost(post({ intent: CONDUCT_INTENT, version }), backend, "/back")).toEqual({ kind: "redirect", location: "/back" });
      expect(backend.acknowledge, `version ${version}`).not.toHaveBeenCalled();
    }
  });

  it("lets a failed write surface to the page, never a silent success", async () => {
    const backend = actions();
    backend.acknowledge.mockRejectedValueOnce(new Error("D1 down"));
    await expect(handleConductPost(post(agree), backend, "/back")).rejects.toThrow("D1 down");
  });
});

describe("who has agreed", () => {
  it("counts only an agreement to the words as they are now", () => {
    expect(conductAgreed(null)).toBe(false);
    expect(conductAgreed({ version: CONDUCT_VERSION, acknowledgedAt: 1, current: true })).toBe(true);
    expect(conductAgreed({ version: CONDUCT_VERSION - 1, acknowledgedAt: 1, current: false })).toBe(false);
  });
});
