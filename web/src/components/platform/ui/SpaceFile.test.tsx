import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import Sheet from "./Sheet";
import SpaceFile, { type SpaceTabItem } from "./SpaceFile";
import { SPACE_ORDER } from "@/lib/platform/contracts";
import { SPACES, type Space } from "./spaces";

const PERSON = { id: "fixture-amina-hassan", name: "Amina Hassan" };

const STAFF: SpaceTabItem[] = [
  { space: "profile", label: "Profile", href: "/p" },
  { space: "admin", label: "Admin", href: "/a", count: 3 },
  { space: "cohort", label: "Cohort", href: "/c", unread: true },
  { space: "mentoring", label: "Mentoring", href: "/m" },
  { space: "community", label: "Community", href: "/co", count: 0, unread: true },
];

function render(active: Space = "admin", tabs = STAFF) {
  return renderToStaticMarkup(
    <SpaceFile tabs={tabs} active={active} person={PERSON}>
      <p>content</p>
    </SpaceFile>,
  );
}

describe("Sheet", () => {
  it("takes its space's tone", () => {
    const html = renderToStaticMarkup(
      <Sheet space="mentoring" as="section" aria-label="Requests">
        x
      </Sheet>,
    );
    expect(html).toMatch(/^<section aria-label="Requests" data-sheet="mentoring" data-space-tone="mentoring"/);
    expect(html).toContain('class="platform-sheet"');
  });
});

describe("SpaceFile", () => {
  it("is a named navigation list of links", () => {
    const html = render();
    expect(html).toContain('<nav aria-label="Spaces"');
    expect(html.match(/<li class="space-tab"/g)).toHaveLength(5);
    expect(html.match(/<a class="space-tab__link" href=/g)).toHaveLength(5);
  });

  it("always orders spaces the same way, with Profile last", () => {
    const order = [...render().matchAll(/data-space="([a-z]+)"/g)].map((m) => m[1]);
    expect(order).toEqual(["cohort", "community", "mentoring", "admin", "profile"]);
    expect(SPACES.at(-1)).toBe("profile");
  });

  it("uses the contract's space order exactly", () => {
    expect([...SPACES]).toEqual([...SPACE_ORDER]);
  });

  it("marks exactly one tab as the current page, and the sheet takes its tone", () => {
    const html = render("admin");
    expect(html.match(/aria-current="page"/g)).toHaveLength(1);
    expect(html).toMatch(/data-space="admin" data-space-tone="admin" data-active="true"><a class="space-tab__link" href="\/a" aria-current="page"/);
    expect(html).toContain('data-sheet="admin"');
  });

  it("tints every tab with its own space's tone", () => {
    for (const { space } of STAFF) expect(render()).toContain(`data-space="${space}" data-space-tone="${space}"`);
  });

  it("reads counts with their meaning and names an unread dot", () => {
    const html = render();
    expect(html).toContain('<span class="sr-only">3 new</span>');
    expect(html.match(/<span class="sr-only">new activity<\/span>/g)).toHaveLength(2);
  });

  it("prefers a count to a dot, and drops a zero count", () => {
    const html = render("cohort", [
      { space: "cohort", label: "Cohort", href: "/c", count: 2, unread: true },
      { space: "profile", label: "Profile", href: "/p", count: 0 },
    ]);
    expect(html).toContain("2 new");
    expect(html).not.toContain("new activity");
    expect(html.match(/data-count-badge/g)).toHaveLength(1);
  });

  it("keeps every label in the markup, even where narrow rows hide it", () => {
    const html = render();
    for (const { label } of STAFF) expect(html).toContain(`<span class="space-tab__label">${label}</span>`);
  });

  it("wears the person's avatar on the Profile tab, silently", () => {
    const html = render();
    expect(html).toMatch(/data-space="profile"[^]*data-avatar="fixture-amina-hassan"[^]*aria-hidden="true"/);
  });

  it("puts end content in the row only when given", () => {
    expect(render()).not.toContain("space-file__end");
    const html = renderToStaticMarkup(
      <SpaceFile tabs={STAFF} active="admin" person={PERSON} end={<b>tools</b>}>
        x
      </SpaceFile>,
    );
    expect(html).toContain('<div class="space-file__end"><b>tools</b></div>');
  });

  it("tells the stylesheet how many tabs it holds, which sets when labels fold", () => {
    expect(render()).toContain('data-tabs="5"');
    expect(render("cohort", STAFF.slice(0, 2))).toContain('data-tabs="2"');
  });
});

describe("display face", () => {
  it("appears in the primitives only as Tembo's T", () => {
    const sources = readdirSync(__dirname).filter((file) => file.endsWith(".tsx") && !file.endsWith(".test.tsx"));
    const users = sources.filter((file) => readFileSync(join(__dirname, file), "utf8").includes("font-heading"));
    expect(users).toEqual(["TemboMark.tsx"]);
  });
});
