import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import * as kit from "@/components/platform/ui";
import { CATALOGUE } from "./catalogue";
import LiveSpecimen from "./LiveSpecimen";
import { GUIDE_SECTIONS, guideSection } from "./sections";

/** Exports that are plumbing rather than parts: helpers, types' runtime twins, constants. */
const NOT_PARTS = new Set(["avatarColour", "initials", "cx", "fieldAria", "fieldId", "BUTTON_VARIANTS", "FOCUS_RING", "INSET_FOCUS_RING", "ButtonRecipe"]);

describe("the public catalogue", () => {
  it("shows every component the kit exports, so the guide cannot fall behind the code", () => {
    const shown = new Set(CATALOGUE.flatMap((entry) => entry.exports));
    const parts = Object.keys(kit).filter((name) => !NOT_PARTS.has(name));
    expect(parts.filter((name) => !shown.has(name))).toEqual([]);
  });

  it("only names exports that exist", () => {
    for (const entry of CATALOGUE) {
      for (const name of entry.exports) expect(kit, `${entry.id}: ${name}`).toHaveProperty(name);
    }
  });

  it("gives every entry a unique anchor", () => {
    const ids = CATALOGUE.map((entry) => entry.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const id of ids) expect(id).toMatch(/^[a-z][a-z-]*$/);
  });

  it("renders every specimen on the server without throwing, and says something in each list", () => {
    for (const entry of CATALOGUE) {
      expect(renderToStaticMarkup(<>{entry.specimen()}</>).length, `${entry.id}`).toBeGreaterThan(0);
      for (const list of [entry.use, entry.avoid, entry.access]) expect(list.length, `${entry.id}`).toBeGreaterThan(0);
      expect(entry.code.trim().length, `${entry.id}`).toBeGreaterThan(0);
    }
  });

  it("keeps every field id in its specimens unique, as one page needs", () => {
    const html = CATALOGUE.map((entry) => renderToStaticMarkup(<>{entry.specimen()}</>)).join("");
    const ids = [...html.matchAll(/\sid="([^"]+)"/g)].map((match) => match[1]);
    expect(ids.filter((id, index) => ids.indexOf(id) !== index)).toEqual([]);
  });

  it("never takes focus on load, so the guide's own page keeps it", () => {
    const html = CATALOGUE.map((entry) => renderToStaticMarkup(<>{entry.specimen()}</>)).join("");
    expect(html).not.toContain("autofocus");
  });

  it("names each tab-file navigation uniquely, so landmarks can be told apart", () => {
    const html = CATALOGUE.map((entry) => renderToStaticMarkup(<>{entry.specimen()}</>)).join("");
    const labels = [...html.matchAll(/<nav aria-label="([^"]+)"/g)].map((match) => match[1]);
    expect(new Set(labels).size).toBe(labels.length);
    expect(labels).not.toContain("Style guide");
  });

  it("renders each live demonstration in its resting state on the server", () => {
    for (const entry of CATALOGUE.filter((candidate) => candidate.live)) {
      const html = renderToStaticMarkup(<LiveSpecimen demo={entry.live!} />);
      expect(html, `${entry.id}`).not.toContain('aria-busy="true"');
      expect(html.length).toBeGreaterThan(0);
    }
  });
});

describe("the guide's sections", () => {
  it("each have their own page under /style-guide and a sheet tone of their own", () => {
    expect(GUIDE_SECTIONS.map((section) => section.href)).toEqual([
      "/style-guide",
      "/style-guide/foundations",
      "/style-guide/components",
      "/style-guide/patterns",
      "/style-guide/voice",
    ]);
    expect(new Set(GUIDE_SECTIONS.map((section) => section.tone)).size).toBe(GUIDE_SECTIONS.length);
  });

  it("describe themselves within what a search result shows", () => {
    for (const section of GUIDE_SECTIONS) expect(section.description.length, `${section.id}`).toBeLessThanOrEqual(160);
  });

  it("refuse an unknown section", () => {
    expect(() => guideSection("nope" as never)).toThrow(/No style guide section/);
  });
});
