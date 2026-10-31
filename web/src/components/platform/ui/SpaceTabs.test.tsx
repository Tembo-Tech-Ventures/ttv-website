import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import Card from "./Card";
import Pill from "./Pill";
import Sheet from "./Sheet";
import SpaceTabs, { orderSpaces, SPACE_LABELS, type SpaceTabItem } from "./SpaceTabs";
import { SHEET_BG, SPACE_ORDER } from "./tokens";

const html = renderToStaticMarkup;

const STAFF: SpaceTabItem[] = [
  { id: "profile", href: "/dashboard/me" },
  { id: "admin", href: "/admin", count: 3 },
  { id: "cohort", href: "/dashboard/cohort" },
  { id: "mentoring", href: "/dashboard/mentoring" },
  { id: "community", href: "/dashboard/community", count: 5 },
];

/** Tab elements in document order, as [id, attributes] pairs. */
function tabs(markup: string) {
  return Array.from(markup.matchAll(/<a ([^>]*data-space-tab="([a-z]+)"[^>]*)>/g), (m) => [m[2], m[1]] as const);
}

describe("orderSpaces", () => {
  it("always uses the fixed space order, Profile last, whatever order it is given", () => {
    expect(orderSpaces(STAFF).map((s) => s.id)).toEqual(["cohort", "community", "mentoring", "admin", "profile"]);
  });

  it("drops duplicates, keeping the first", () => {
    const ordered = orderSpaces([
      { id: "community", href: "/a", count: 1 },
      { id: "community", href: "/b" },
    ]);
    expect(ordered).toEqual([{ id: "community", href: "/a", count: 1 }]);
  });

  it("knows every space's label", () => {
    expect(Object.keys(SPACE_LABELS).toSorted()).toEqual([...SPACE_ORDER].toSorted());
  });
});

describe("SpaceTabs", () => {
  it("is a labelled navigation list of links, not an ARIA tablist", () => {
    const markup = html(<SpaceTabs spaces={STAFF} active="admin" />);
    expect(markup).toMatch(/^<nav aria-label="Spaces"/);
    expect(markup).toContain("<ul ");
    expect(markup).not.toContain('role="tab');
    expect(tabs(markup).map(([id]) => id)).toEqual(["cohort", "community", "mentoring", "admin", "profile"]);
  });

  it("marks exactly the active space as the current page", () => {
    const markup = html(<SpaceTabs spaces={STAFF} active="admin" />);
    const current = tabs(markup).filter(([, attrs]) => attrs.includes('aria-current="page"'));
    expect(current.map(([id]) => id)).toEqual(["admin"]);
  });

  it("marks no tab current when the active space is not one of theirs", () => {
    const markup = html(<SpaceTabs spaces={[{ id: "community", href: "/c" }]} active="admin" />);
    expect(markup).not.toContain("aria-current");
  });

  it("links each tab to its space", () => {
    const markup = html(<SpaceTabs spaces={STAFF} active="admin" />);
    expect(markup).toContain('href="/dashboard/community"');
    expect(markup).toContain('href="/admin"');
  });

  it("tints each tab with its own space's tone", () => {
    const markup = html(<SpaceTabs spaces={STAFF} active="admin" />);
    for (const [id, attrs] of tabs(markup)) {
      expect(attrs).toContain(`--pf-tab:var(--color-sheet-${id})`);
    }
  });

  it("grows the active tab out of the sheet with two concave fillets", () => {
    const [, active] = tabs(html(<SpaceTabs spaces={STAFF} active="admin" />)).find(([id]) => id === "admin")!;
    expect(active).toContain("z-[2]");
    expect(active).toContain("-mb-px");
    expect(active).toContain("before:bg-[radial-gradient(circle_at_0_0,transparent_13.5px,var(--pf-tab)_14px)]");
    expect(active).toContain("after:bg-[radial-gradient(circle_at_100%_0,transparent_13.5px,var(--pf-tab)_14px)]");
  });

  it("tucks inactive tabs under the sheet, leaving a 44px target showing", () => {
    const [, inactive] = tabs(html(<SpaceTabs spaces={STAFF} active="admin" />)).find(([id]) => id === "cohort")!;
    expect(inactive).toContain("z-0");
    expect(inactive).toContain("h-12");
    expect(inactive).toContain("translate-y-1");
    expect(inactive).toContain("min-w-11");
    expect(inactive).not.toContain("before:");
  });

  it("keeps every label in the accessible name, even when a narrow row hides it", () => {
    const markup = html(<SpaceTabs spaces={STAFF} active="admin" />);
    for (const id of ["cohort", "community", "mentoring", "profile"]) {
      expect(markup).toContain(`title="${SPACE_LABELS[id as keyof typeof SPACE_LABELS]}"`);
    }
    expect(markup.match(/class="@max-xl:sr-only">/g)).toHaveLength(4);
    // The active tab's label is never hidden.
    expect(markup).toMatch(/<span data-space-label="">Admin<\/span>/);
  });

  it("speaks counts and dots, never a bare number", () => {
    const markup = html(
      <SpaceTabs
        spaces={[
          { id: "cohort", href: "/c", count: 2 },
          { id: "community", href: "/m", unread: true },
          { id: "profile", href: "/p", count: 0 },
        ]}
        active="cohort"
      />
    );
    expect(markup).toContain(">2 new<");
    expect(markup).toContain(">New activity<");
    expect(markup.match(/class="sr-only">/g)?.length).toBe(2);
  });

  it("shows the person's own face on Profile, and nothing invented without one", () => {
    const withFace = html(
      <SpaceTabs spaces={[{ id: "profile", href: "/p" }]} active="profile" profile={{ id: "u1", name: "Wanjiku Mwangi" }} />
    );
    expect(withFace).toContain(">WM<");
    expect(withFace).toContain('aria-hidden="true"');
    const withoutFace = html(<SpaceTabs spaces={[{ id: "profile", href: "/p" }]} active="profile" />);
    expect(withoutFace).not.toContain("data-avatar");
  });

  it("starts the row past the sheet's corner, so no fillet lands on its curve", () => {
    // Sheet corner 24px (28px from sm) + 14px fillet ⇒ 40px (44px) inset.
    expect(html(<SpaceTabs spaces={STAFF} active="cohort" />)).toContain("ps-10 sm:ps-11");
    const sheet = html(<Sheet tone="cohort">x</Sheet>);
    expect(sheet).toContain("rounded-t-[24px]");
    expect(sheet).toContain("sm:rounded-t-[28px]");
  });

  it("puts each space's marker on its tab", () => {
    const markup = html(<SpaceTabs spaces={STAFF} active="admin" />);
    expect(markup).toContain('data-marker="builder"');
    expect(markup).toContain('data-marker="community"');
    expect(markup).toContain('data-marker="mentor"');
    expect(markup).toContain('data-marker="staff"');
  });
});

describe("Sheet", () => {
  it("takes its tone's colour and publishes it for the avatars on it", () => {
    for (const tone of SPACE_ORDER) {
      const markup = html(<Sheet tone={tone}>content</Sheet>);
      expect(markup).toContain(SHEET_BG[tone]);
      expect(markup).toContain(`--pf-surface:var(--color-sheet-${tone})`);
      expect(markup).toContain(`data-sheet="${tone}"`);
    }
  });

  it("sits between the inactive tabs and the active one", () => {
    expect(html(<Sheet tone="profile">x</Sheet>)).toContain("relative z-[1]");
  });

  it("can be a landmark and keeps caller styles", () => {
    const markup = html(
      <Sheet tone="community" as="main" style={{ minHeight: 10 }} aria-label="Community">
        x
      </Sheet>
    );
    expect(markup).toMatch(/^<main /);
    expect(markup).toContain("min-height:10px");
    expect(markup).toContain('aria-label="Community"');
  });
});

describe("Card", () => {
  it("is a translucent lift with a hairline, as any element", () => {
    const markup = html(<Card as="article">x</Card>);
    expect(markup).toMatch(/^<article /);
    expect(markup).toContain("bg-ink-primary/4");
    expect(markup).toContain("border-ink-primary/9");
  });

  it("shows selection with a peach edge and the same fill", () => {
    const markup = html(<Card selected>x</Card>);
    expect(markup).toContain('data-selected="true"');
    expect(markup).toContain("border-primary/45");
    expect(markup).toContain("bg-ink-primary/4");
  });
});

describe("Pill", () => {
  it.each([
    ["neutral", "text-sheet-ink-secondary"],
    ["peach", "text-peach-ink"],
    ["ring", "text-ring"],
  ] as const)("has a %s tone", (tone, cls) => {
    expect(html(<Pill tone={tone}>Label</Pill>)).toContain(cls);
  });

  it("is a static label, not a control, with a decorative icon", () => {
    const markup = html(<Pill icon={<svg data-icon="" />}>Session 9</Pill>);
    expect(markup).toMatch(/^<span /);
    expect(markup).not.toContain("<button");
    expect(markup).toMatch(/<span aria-hidden="true" class="inline-flex"><svg data-icon=""/);
  });
});
