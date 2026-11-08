import { readdirSync, readFileSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { ADMIN_SPACE_PAGES } from "@/components/platform/spaces/sidebar";
import { ADMIN_PAGE_HREFS, type AdminPageNavKey } from "./admin-nav";

/**
 * Every admin page is drawn in the Admin space while `spaces` is on for the admin (T02, T14), and in
 * the existing admin shell otherwise. resolveSpacePage decides which (space-page.test.ts: null with
 * spaces off, for a personal access token, a non-admin or a failed context), and AdminLayout draws
 * AdminShell for null. This holds each page to that wiring: it resolves the key of the section it
 * sits under, so that sidebar entry is current, hands the context to AdminLayout, and draws its
 * title as the screen's h1 in the spaces shell and as the h2 it always had (or nothing) otherwise.
 * A page on the style guide has retired that flag-off title (decision D1): its h1 is the same in both.
 */
const PAGES = resolve(import.meta.dirname, "../../pages/admin");

function files(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    return entry.isDirectory() ? files(path) : entry.name.endsWith(".astro") ? [path] : [];
  });
}

/** The route a page file serves: users/[id].astro is /admin/users/[id], users/index.astro is /admin/users. */
function route(file: string): string {
  return `/admin/${relative(PAGES, file).replace(/\.astro$/, "").replace(/(^|\/)index$/, "")}`.replace(/\/$/, "");
}

/** The admin section a route sits under: the longest admin page path that is it or a parent of it. */
function section(path: string): AdminPageNavKey {
  const keys = Object.keys(ADMIN_PAGE_HREFS) as AdminPageNavKey[];
  const under = keys.filter((key) => path === ADMIN_PAGE_HREFS[key] || path.startsWith(`${ADMIN_PAGE_HREFS[key]}/`));
  return under.toSorted((a, b) => ADMIN_PAGE_HREFS[b].length - ADMIN_PAGE_HREFS[a].length)[0]!;
}

const pages = files(PAGES).map((file) => ({ path: route(file), source: readFileSync(file, "utf8") }));

describe("admin pages in the spaces shell", () => {
  it("covers every admin page", () => {
    expect(pages.length).toBeGreaterThanOrEqual(30);
    expect(pages.map((page) => page.path)).toEqual(expect.arrayContaining(["/admin", "/admin/users/[id]", "/admin/programs/new"]));
  });

  for (const { path, source } of pages) {
    describe(`${path}`, () => {
      it("resolves the Admin space under its own section's sidebar entry", () => {
        const calls = [...source.matchAll(/resolveSpacePage\(Astro\.locals, "(\w+)"\)/g)].map((match) => match[1]);
        expect(calls).toEqual([ADMIN_SPACE_PAGES[section(path)]]);
      });

      it("hands that context to AdminLayout", () => {
        expect(source).toMatch(/<AdminLayout\b[^>]*\sspaces=\{spaces\}/);
      });

      it("draws its title as the h1 in the spaces shell, and as before (or as the same h1) in the existing admin shell", () => {
        const pageTitle = /<PageTitle spaces=\{Boolean\(spaces\)\}/.test(source);
        const switched = /const (Title|titleTag) = spaces \? "h1" : "h2";/.test(source);
        const retired = /<PageTitle spaces>/.test(source);
        expect(pageTitle || switched || retired).toBe(true);
      });
    });
  }
});
