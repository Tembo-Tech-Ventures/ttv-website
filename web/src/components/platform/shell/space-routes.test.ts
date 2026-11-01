import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { InternalPath, SPACE_ORDER } from "@/lib/platform/contracts";
import { canonicalSpacePath, SPACE_PATHS, SPACE_REDIRECTS, spaceForPath } from "@/lib/platform/server/space-routes";
import { ACCOUNT_HREF, opensInShell, SIGN_OUT_HREF, SPACE_HOME, SPACE_LABEL } from "./space-routes";

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

  it("knows which pages open in the shell, so only those finish the sheet transition", () => {
    for (const path of ["/dashboard", "/dashboard/cohort", "/dashboard/cohort/sessions/r1", "/dashboard/community/", "/dashboard/me/leads", "/dashboard/account", "/dashboard/attention", "/dashboard/feedback", "/dashboard/discover", "/dashboard/mentoring/confirm"]) {
      expect({ path, opens: opensInShell(path) }).toEqual({ path, opens: true });
    }
    // Admin is a space with its own frame; the rest are outside the app or not spaces pages.
    for (const path of ["/admin", "/admin/users", "/community/members", "/certificate/a1", "/", "/dashboard/sessions-old", "/auth/logout"]) {
      expect({ path, opens: opensInShell(path) }).toEqual({ path, opens: false });
    }
  });

  it("leaves the /dashboard entry as the only redirect onto a space home, which the landing hint relies on", () => {
    const homes = new Set<string>(Object.values(SPACE_HOME));
    for (const [legacy, canonical] of SPACE_REDIRECTS) {
      expect({ legacy, ontoHome: homes.has(canonical) }).toEqual({ legacy, ontoHome: false });
    }
  });
});
