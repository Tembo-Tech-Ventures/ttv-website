import { experimental_AstroContainer as AstroContainer } from "astro/container";
import { loadRenderers } from "astro:container";
import { getContainerRenderer } from "@astrojs/react/container-renderer";
import { beforeAll, describe, expect, it, vi } from "vitest";
import { CATALOGUE } from "@/components/style-guide/catalogue";
import { GUIDE_SECTIONS } from "@/components/style-guide/sections";
import { COLOUR_GROUPS, colourToken } from "@/lib/design/tokens";

vi.mock("cloudflare:workers", () => ({ env: {} }));

const PAGES = {
  principles: await import("../index.astro"),
  foundations: await import("../foundations.astro"),
  components: await import("../components.astro"),
  patterns: await import("../patterns.astro"),
  voice: await import("../voice.astro"),
} as const;

let container: AstroContainer;
const html: Record<string, string> = {};

beforeAll(async () => {
  container = await AstroContainer.create({ renderers: await loadRenderers([getContainerRenderer()]) });
  for (const section of GUIDE_SECTIONS) {
    html[section.id] = await container.renderToString(PAGES[section.id].default, {
      request: new Request(`https://tembotechventures.com${section.href}`),
      locals: {} as App.Locals,
    });
  }
});

const all = (text: string, pattern: RegExp) => [...text.matchAll(pattern)].map((match) => match[1]);

describe.each(GUIDE_SECTIONS)("the $label page", (section) => {
  const page = () => html[section.id];

  it("has one display title, the section's, and a page title and description of its own", () => {
    expect(page().match(/<h1\b/g)).toHaveLength(1);
    expect(page()).toMatch(new RegExp(`<h1[^>]*>${section.title}</h1>`));
    expect(page()).toContain(`<meta name="description" content="${section.description}"`);
    expect(page()).toMatch(section.id === "principles" ? /<title>Style guide\b/ : new RegExp(`<title>${section.title} · Style guide\\b`));
  });

  it("stands in the guide's tab file, with this section's tab current and its sheet in its tone", () => {
    const nav = /<nav aria-label="Style guide"[^>]*>([\s\S]*?)<\/nav>/.exec(page())?.[1] ?? "";
    expect(all(nav, /href="([^"]+)"/g)).toEqual(GUIDE_SECTIONS.map((candidate) => candidate.href));
    expect(all(nav, /href="([^"]+)" aria-current="page"/g)).toEqual([section.href]);
    expect(page()).toContain(`data-space-file="${section.id}" data-tabs="5" data-fold="off"`);
    expect(page()).toContain(`data-sheet="${section.tone}"`);
  });

  it("points every “On this page” link at a section that exists, and every section is listed", () => {
    const contents = /<nav aria-label="On this page"[^>]*>([\s\S]*?)<\/nav>/.exec(page())?.[1] ?? "";
    const anchors = all(contents, /href="#([^"]+)"/g);
    const sections = all(page(), /<section id="([^"]+)"[^>]*data-guide-section/g);
    expect(anchors.length).toBeGreaterThan(2);
    expect(anchors).toEqual(sections);
  });

  it("never repeats an id", () => {
    const ids = all(page(), /\sid="([^"]+)"/g);
    expect(ids.filter((id, index) => ids.indexOf(id) !== index)).toEqual([]);
  });

  it("names every navigation landmark differently", () => {
    const labels = all(page(), /<nav aria-label="([^"]+)"/g);
    expect(new Set(labels).size).toBe(labels.length);
  });

  it("uses Maven Pro for every section heading: the display face is the page title's", () => {
    for (const heading of page().match(/<h2[^>]*>/g) ?? []) expect(heading).toContain("font-body");
  });
});

describe("the components page", () => {
  it("has a section, an example and usage code for every part in the catalogue", () => {
    for (const entry of CATALOGUE) {
      expect(html.components).toContain(`<section id="${entry.id}"`);
      expect(html.components).toContain(`aria-labelledby="${entry.id}-title"`);
    }
    expect(html.components.match(/data-code/g)?.length).toBeGreaterThanOrEqual(CATALOGUE.length);
  });

  it("hydrates only the demonstrations you can press, when they come into view", () => {
    const islands = html.components.match(/<astro-island\b[^>]*>/g) ?? [];
    expect(islands).toHaveLength(CATALOGUE.filter((entry) => entry.live).length);
    for (const island of islands) {
      expect(island).toContain('component-url="@/components/style-guide/LiveSpecimen"');
      expect(island).toContain('client="visible"');
    }
  });
});

describe("the foundations page", () => {
  it("prints every colour token exactly as the stylesheet defines it", () => {
    for (const { colours } of COLOUR_GROUPS) {
      for (const { token } of colours) expect(html.foundations).toContain(`--color-${token} · ${colourToken(token).replace(/"/g, "&quot;")}`);
    }
  });

  it("prints measured contrast, never below AA", () => {
    const ratios = all(html.foundations, /(\d+\.\d{2}):1 at worst/g).map(Number);
    expect(ratios.length).toBe(8);
    for (const ratio of ratios) expect(ratio).toBeGreaterThanOrEqual(4.5);
  });
});

describe("the principles page", () => {
  it("states the quietest ink's measured floor rather than a number typed by hand", () => {
    expect(html.principles).toMatch(/The quietest ink measures \d\.\d{2}:1 at its worst/);
  });

  it("links on to every other section and to the engineering guide", () => {
    for (const section of GUIDE_SECTIONS.slice(1)) expect(html.principles).toContain(`href="${section.href}" data-variant`);
    expect(html.principles).toContain("https://github.com/Tembo-Tech-Ventures/ttv-website/tree/main/web/docs/design-system");
  });
});

describe("the voice page", () => {
  it("pairs what we write with what we don't, readably without colour", () => {
    expect(html.voice.match(/data-word-pair/g)?.length).toBeGreaterThanOrEqual(10);
    expect(html.voice.match(/<span class="sr-only">Write: <\/span>/g)?.length).toBe(html.voice.match(/data-word-pair/g)?.length);
  });
});
