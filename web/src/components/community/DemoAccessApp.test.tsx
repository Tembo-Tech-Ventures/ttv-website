import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import DemoAccessApp from "./DemoAccessApp";

describe("demo access application", () => {
  it("shows an operator sign-out before selecting a persona", () => {
    const html = renderToStaticMarkup(<DemoAccessApp activePersona={null} displayName="Operator" expiresAt="2026-10-25T14:00:00Z" canSwitch />);
    expect(html).toContain("Choose a demo role");
    expect(html).toContain("Sign out");
    expect(html).toContain("original admin session");
    expect(html).not.toContain("Fictional demo profile");
  });
  it("identifies the current persona while keeping role selection on the same page", () => {
    const html = renderToStaticMarkup(<DemoAccessApp activePersona="mentor" displayName="Fictional Mentor" expiresAt="2026-10-25T14:00:00Z" canSwitch />);
    expect(html).toContain("Fictional Mentor · Mentor");
    expect(html).toContain("Current role");
    expect(html).not.toContain("Switch role");
    expect(html).toContain("To try another role, choose it above");
  });
});
