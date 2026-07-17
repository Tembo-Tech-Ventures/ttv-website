import { describe, expect, it } from "vitest";
import { getAdminLinks } from "./AdminShell";

describe("admin navigation", () => {
  it("shows agent access only when the runtime capability is enabled", () => {
    expect(getAdminLinks(false).map(({ label }) => label)).not.toContain("Agent Access");
    expect(getAdminLinks(true).map(({ label }) => label)).toContain("Agent Access");
  });
});
