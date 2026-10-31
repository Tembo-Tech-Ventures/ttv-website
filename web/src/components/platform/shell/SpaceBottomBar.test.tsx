import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import SpaceBottomBar from "./SpaceBottomBar";
import type { SpaceLink } from "./SpacesShell";

const PERSON = { id: "fixture-wanjiku", name: "Wanjiku Mwangi" };
const LINKS: SpaceLink[] = [
  { space: "cohort", label: "Cohort", href: "/dashboard/cohort", count: 2 },
  { space: "community", label: "Community", href: "/dashboard/community", count: 0 },
  { space: "profile", label: "Profile", href: "/dashboard/me", count: 12 },
];

describe("SpaceBottomBar", () => {
  const html = renderToStaticMarkup(<SpaceBottomBar links={LINKS} active="cohort" person={PERSON} />);

  it("is the phone's named list of spaces, in the order given", () => {
    expect(html).toMatch(/^<nav aria-label="Spaces" class="spaces-bottom" data-count="3">/);
    expect([...html.matchAll(/data-space="([a-z]+)"/g)].map((match) => match[1])).toEqual(["cohort", "community", "profile"]);
  });

  it("marks the current space and nothing else", () => {
    expect(html.match(/aria-current="page"/g)).toHaveLength(1);
    expect(html).toMatch(/href="\/dashboard\/cohort" aria-current="page"/);
  });

  it("says each count once, after the space's name", () => {
    expect(html).toContain('<span class="sr-only">, 2 new</span>');
    expect(html).toContain('<span class="sr-only">, 12 new</span>');
    expect(html).not.toContain(", 0 new");
    // The visible badge sits inside the decorative glyph, so it is not read twice.
    expect(html).toMatch(/<span aria-hidden="true" class="spaces-bottom__glyph">.*?2 new.*?<\/span><span class="spaces-bottom__label">Cohort/);
  });

  it("wears the person's avatar for Profile", () => {
    expect(html).toContain('data-avatar="fixture-wanjiku"');
  });
});
