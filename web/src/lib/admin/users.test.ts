import { describe, expect, it } from "vitest";
import { adminRoleNotice, roleLabel } from "./users";

describe("roleLabel", () => {
  it("says a stored role as a word, never in capitals", () => {
    expect(roleLabel("ADMIN")).toBe("Admin");
    expect(roleLabel("INSTITUTION")).toBe("Institution");
    expect(roleLabel("TEACHING_ASSISTANT")).toBe("Teaching assistant");
  });
});

describe("adminRoleNotice", () => {
  it("says what changed in words, and says so when nothing did", () => {
    expect(adminRoleNotice("add-admin", true)).toBe("Admin access was given.");
    expect(adminRoleNotice("remove-admin", true)).toBe("Admin access was removed.");
    expect(adminRoleNotice("remove-admin", false)).toBe("Admin access was already up to date.");
  });
});
