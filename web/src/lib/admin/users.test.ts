import { describe, expect, it } from "vitest";
import { roleLabel } from "./users";

describe("roleLabel", () => {
  it("says a stored role as a word, never in capitals", () => {
    expect(roleLabel("ADMIN")).toBe("Admin");
    expect(roleLabel("INSTITUTION")).toBe("Institution");
    expect(roleLabel("TEACHING_ASSISTANT")).toBe("Teaching assistant");
  });
});
