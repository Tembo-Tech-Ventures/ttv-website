import { describe, expect, it } from "vitest";
import { shellAccount } from "./account";

const user = { id: "u1" } as App.Locals["user"];
const qa = { runId: "r", persona: "mentor", userId: "u1", sessionId: "s", issuedAt: 0, expiresAt: 1 } as App.Locals["stagingQa"];

describe("shellAccount", () => {
  it("signs a person out through the link, with feedback on", () => {
    expect(shellAccount({ user })).toEqual({ signOut: { kind: "link", href: "/auth/logout", label: "Sign out" }, feedback: true });
  });

  it("signs a staging QA persona out by posting to its own endpoint, without feedback", () => {
    expect(shellAccount({ user, stagingQa: qa })).toEqual({
      signOut: { kind: "form", action: "/api/qa/logout", label: "Sign out of this QA persona" }, feedback: false,
    });
  });

  it("takes a demo session back to the demo controls", () => {
    expect(shellAccount({ user, stagingDemo: { persona: "mentor", expiresAt: 1 } }).signOut)
      .toEqual({ kind: "link", href: "/demo", label: "Demo controls" });
  });

  it("offers no feedback without a signed-in person", () => {
    expect(shellAccount({ user: null }).feedback).toBe(false);
  });
});
