import { describe, expect, it } from "vitest";
import { FROZEN } from "./kit-compliance.frozen";
import { KIT_RULES } from "./kit-compliance.rules";
import { scanKitCompliance } from "./kit-compliance.scan";

/*
 * A shrink-only ratchet on what the TTV UI kit and its tokens replace (PLAN
 * 0.4), across src/pages and src/components: raw colour utilities, inline
 * rgb(), the form-control utility, the spaces/PageTitle.astro shim and status
 * flags in the query string, and on the platform, eyebrows and the older
 * surface tokens. Every file is frozen at its count in kit-compliance.frozen.ts.
 * A file may not gain a match; when one loses some, its number must come down
 * too, so nothing can quietly come back. legacy-ui.test.ts does the same for
 * the form-control utility.
 */
const SCAN = scanKitCompliance();

describe.each(Object.entries(KIT_RULES))("%s", (name, { instead }) => {
  const counts = SCAN[name] ?? {};
  const frozen = FROZEN[name] ?? {};

  it(`gains no match in any file: use ${instead}`, () => {
    const grown = Object.entries(counts)
      .filter(([path, count]) => count > (frozen[path] ?? 0))
      .map(([path, count]) => `${path}: ${count} (frozen at ${frozen[path] ?? 0})`);
    expect(grown).toEqual([]);
  });

  it("is frozen at each file's current count, so the list only shrinks", () => {
    const shrunk = Object.entries(frozen)
      .filter(([path, count]) => (counts[path] ?? 0) < count)
      .map(([path, count]) => `${path}: ${counts[path] ?? 0} now; lower it from ${count} in kit-compliance.frozen.ts`);
    expect(shrunk).toEqual([]);
  });
});

describe("the frozen counts", () => {
  it("name only the rules there are", () => {
    expect(Object.keys(FROZEN).filter((name) => !(name in KIT_RULES))).toEqual([]);
  });

  it("list no file at zero", () => {
    const zeros = Object.entries(FROZEN).flatMap(([name, files]) => Object.entries(files).filter(([, count]) => count <= 0).map(([path]) => `${name}: ${path}`));
    expect(zeros).toEqual([]);
  });
});

describe("the rules", () => {
  const match = (name: string, text: string) => text.match(KIT_RULES[name]!.pattern)?.length ?? 0;

  it("catch the raw colours the guide forbids, and leave the tokens alone", () => {
    expect(match("raw white or black", `class="text-white bg-black/40 hover:border-white"`)).toBe(3);
    expect(match("raw white or black", `class="text-ink-primary bg-ground text-dark"`)).toBe(0);
    expect(match("Tailwind palette colours", `class="bg-red-500 text-emerald-300 border-gray-700/50"`)).toBe(3);
    // The theme's own teal token has no shade; only the palette's numbered teals count.
    expect(match("Tailwind palette colours", `class="text-teal bg-danger-ink/10 text-success-ink"`)).toBe(0);
    expect(match("arbitrary colour values", `class="bg-[#012A28] text-[rgb(1,2,3)] w-[42rem]"`)).toBe(2);
    expect(match("inline rgb() and hsl()", `box-shadow: 0 0 0 rgb(0 0 0 / 0.4); color: hsla(1, 2%, 3%, 1); color: var(--color-dark);`)).toBe(2);
  });

  it("catch the legacy parts and the query-string flags", () => {
    expect(match("the form-control utility", `<input class="form-control" />`)).toBe(1);
    expect(match("the spaces/PageTitle.astro shim", `import PageTitle from "@/components/platform/spaces/PageTitle.astro";`)).toBe(1);
    expect(match("the spaces/PageTitle.astro shim", `import { PageTitle } from "@/components/platform/ui";`)).toBe(0);
    expect(match("status flags in the query string", "return Astro.redirect(`${path}?done=accepted`, 303); url.searchParams.get(\"saved\")")).toBe(2);
    expect(match("status flags in the query string", `url.searchParams.get("q"); href="?page=2&filter=open"`)).toBe(0);
  });

  it("catch eyebrows and the older surfaces on the platform only", () => {
    expect(match("eyebrows (uppercase tracked labels)", `class="text-xs uppercase tracking-wide"`)).toBe(1);
    expect(match("eyebrows (uppercase tracked labels)", `class="tracking-display uppercase"`)).toBe(1);
    expect(match("eyebrows (uppercase tracked labels)", `class="text-sm font-semibold"`)).toBe(0);
    expect(match("the older surface tokens", `class="bg-bg-raised border-rule bg-surface"`)).toBe(3);
    const platformOnly = KIT_RULES["the older surface tokens"]!.applies!;
    expect(platformOnly("pages/dashboard/feedback.astro")).toBe(true);
    expect(platformOnly("components/platform/ui/Card.tsx")).toBe(true);
    expect(platformOnly("pages/index.astro")).toBe(false);
    expect(platformOnly("components/homepage/Hero.astro")).toBe(false);
  });

  it("scan pages and components, never tests", () => {
    const files = Object.values(SCAN).flatMap((counts) => Object.keys(counts));
    expect(files.length).toBeGreaterThan(0);
    expect(files.every((path) => /^(?:pages|components)\//.test(path))).toBe(true);
    expect(files.filter((path) => /\.test\.|\/_tests\//.test(path))).toEqual([]);
  });
});
