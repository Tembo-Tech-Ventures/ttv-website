import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { InternalPath, SPACE_ORDER } from "@/lib/platform/contracts";
import { canonicalSpacePath, SPACE_PATHS, spaceForPath } from "@/lib/platform/server/space-routes";
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

  it("links every tab to the canonical route the server serves", () => {
    expect(SPACE_HOME).toBe(SPACE_PATHS);
    for (const space of SPACE_ORDER) {
      expect(spaceForPath(SPACE_HOME[space])).toBe(space);
      expect(canonicalSpacePath(SPACE_HOME[space])).toBeNull();
    }
  });

  it("imports only a pure path map into the client bundle", () => {
    // Islands bundle this module: it must not pull in server runtime code.
    const source = readFileSync(new URL("../../../lib/platform/server/space-routes.ts", import.meta.url), "utf8");
    const imports = source.match(/^import\s[^;]+;/gm) ?? [];
    expect(imports.length).toBeGreaterThan(0);
    for (const statement of imports) expect(statement).toMatch(/^import type\s/);
    expect(source).not.toMatch(/^export\s[^;]*\sfrom\s/m);
  });
});
