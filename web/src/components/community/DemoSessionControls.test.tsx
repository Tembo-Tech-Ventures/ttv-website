import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import DemoSessionControls, { leaveDemoWorkspace } from "./DemoSessionControls";

function effects(approved = true) {
  return { confirm: vi.fn().mockReturnValue(approved), navigate: vi.fn(), logout: vi.fn().mockResolvedValue("/demo") };
}
describe("persistent demo session controls", () => {
  it("shows identity and explicit staging sign-out", () => {
    const html = renderToStaticMarkup(<DemoSessionControls activePersona="institution" displayName="Fictional Partner" expiresAt="2026-10-25T14:00:00Z" />);
    expect(html).toContain("Fictional Partner · Institution");
    expect(html).toContain("Switch role");
    expect(html).toContain("Sign out of staging");
    expect(html).not.toContain("/auth/logout");
  });
  it.each(["switch", "logout"] as const)("keeps the user in place when they cancel %s", async action => {
    const calls = effects(false);
    expect(await leaveDemoWorkspace(action, calls)).toBe(false);
    expect(calls.confirm).toHaveBeenCalledWith(expect.stringContaining("Unsaved changes"));
    expect(calls.navigate).not.toHaveBeenCalled();
    expect(calls.logout).not.toHaveBeenCalled();
  });
  it("switch returns to the protected chooser without ending the operator session", async () => {
    const calls = effects();
    expect(await leaveDemoWorkspace("switch", calls)).toBe(true);
    expect(calls.navigate).toHaveBeenCalledWith("/demo");
    expect(calls.logout).not.toHaveBeenCalled();
  });
  it("explains full logout and waits for revocation before navigating", async () => {
    const calls = effects();
    expect(await leaveDemoWorkspace("logout", calls)).toBe(true);
    expect(calls.confirm).toHaveBeenCalledWith(expect.stringContaining("original admin session"));
    expect(calls.logout).toHaveBeenCalledTimes(1);
    expect(calls.navigate).toHaveBeenCalledWith("/demo");
  });
  it("does not navigate or retry when logout fails", async () => {
    const calls = effects();
    calls.logout.mockRejectedValue(new Error("unavailable"));
    await expect(leaveDemoWorkspace("logout", calls)).rejects.toThrow("unavailable");
    expect(calls.navigate).not.toHaveBeenCalled();
    expect(calls.logout).toHaveBeenCalledTimes(1);
  });
});
