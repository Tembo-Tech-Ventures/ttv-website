import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import DemoSessionIndicator from "./DemoSessionIndicator";

const render = (props: Partial<React.ComponentProps<typeof DemoSessionIndicator>> = {}) => renderToStaticMarkup(<DemoSessionIndicator activePersona="mentor" displayName="Fictional Mentor" expiresAt="2026-10-25T14:00:00Z" canSwitch onSwitch={() => {}} onLogout={() => {}} {...props} />);

describe("demo session indicator", () => {
  it("identifies the actual fictional persona and a timezone-explicit expiry", () => {
    const html = render();
    expect(html).toContain("Fictional Mentor · Mentor");
    expect(html).toContain("Fictional demo profile");
    expect(html).toContain("2026-10-25 14:00 UTC");
    expect(html).toContain("Switch role");
    expect(html).toContain("Sign out");
  });
  it("keeps sign out available when role switching is unavailable", () => {
    const html = render({ canSwitch: false });
    expect(html).not.toContain("Switch role");
    expect(html).toContain("Sign out");
    expect(html).not.toContain('disabled=""');
  });
  it.each(["switch", "logout"] as const)("blocks concurrent actions during %s without claiming success", (pending) => {
    const html = render({ pending });
    expect(html.match(/disabled=""/g)).toHaveLength(2);
    expect(html).toContain('<output');
    expect(html).toContain(pending === "logout" ? "Signing out…" : "Opening role selection…");
    expect(html).toContain("Fictional Mentor · Mentor");
  });
  it("reports failure without retrying or removing the current session", () => {
    const onLogout = vi.fn();
    const onSwitch = vi.fn();
    const html = render({ error: true, onLogout, onSwitch });
    expect(html).toContain('role="alert"');
    expect(html).toContain("Fictional Mentor · Mentor");
    expect(onLogout).not.toHaveBeenCalled();
    expect(onSwitch).not.toHaveBeenCalled();
  });
  it("escapes display names and omits invalid expiry dates", () => {
    const html = render({ displayName: "<script>bad</script>", expiresAt: "invalid" });
    expect(html).not.toContain("<script>");
    expect(html).not.toContain("Invalid Date");
    expect(html).not.toContain("Session ends");
  });
});
