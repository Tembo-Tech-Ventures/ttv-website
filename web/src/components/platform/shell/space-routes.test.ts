import { describe, expect, it } from "vitest";
import { InternalPath, SPACE_ORDER } from "@/lib/platform/contracts";
import { ACCOUNT_HREF, SIGN_OUT_HREF, SPACE_HOME, SPACE_LABEL } from "./space-routes";

describe("space routes", () => {
  it("names and places every space", () => {
    expect(Object.keys(SPACE_HOME).toSorted()).toEqual([...SPACE_ORDER].toSorted());
    expect(Object.keys(SPACE_LABEL).toSorted()).toEqual([...SPACE_ORDER].toSorted());
    for (const href of [...Object.values(SPACE_HOME), ACCOUNT_HREF, SIGN_OUT_HREF]) {
      expect(InternalPath.safeParse(href).success).toBe(true);
    }
  });

  it("keeps the spaces the cookie remembers under its /dashboard path", () => {
    // ttv-last-space is scoped to Path=/dashboard; Admin keeps its own shell for deeper pages.
    for (const space of SPACE_ORDER.filter((id) => id !== "admin")) {
      expect(SPACE_HOME[space].startsWith("/dashboard/")).toBe(true);
    }
  });

  it("gives every space a distinct home and label", () => {
    expect(new Set(Object.values(SPACE_HOME)).size).toBe(SPACE_ORDER.length);
    expect(new Set(Object.values(SPACE_LABEL)).size).toBe(SPACE_ORDER.length);
  });
});
