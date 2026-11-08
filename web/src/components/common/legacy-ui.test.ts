import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { describe, expect, it } from "vitest";

/*
 * A ratchet on the parts the TTV UI kit replaces (docs/design-system/README.md).
 *
 * `common/Button.astro`, `common/Card.astro`, `common/Badge.astro` and the
 * `form-control` utility predate the kit in `components/platform/ui`. The files
 * below still use them; nothing new may. When you move a file onto the kit,
 * delete its line here too: the second test fails until you do, so the lists
 * only ever shrink.
 */
const SRC = resolve(__dirname, "../..");

const LEGACY: Record<string, { pattern: RegExp; files: readonly string[] }> = {
  "common/Button.astro": {
    pattern: /common\/Button(\.astro)?["']/,
    files: [
    "components/platform/application/ApplicationAnswers.astro",
    "pages/admin/programs/new.astro",
    "pages/admin/recordings/import.astro",
    "pages/admin/recordings/upload.astro",
    "pages/dashboard/apply.astro",
    "pages/dashboard/leads.astro",
    "pages/dashboard/portfolio.astro",
    "pages/dashboard/profile.astro",
    "pages/dashboard/writing/index.astro",
    ],
  },
  "common/Card.astro": {
    pattern: /common\/Card(\.astro)?["']/,
    files: [
    "pages/admin/programs/new.astro",
    "pages/admin/recordings/import.astro",
    "pages/admin/recordings/upload.astro",
    "pages/dashboard/application/[id].astro",
    "pages/dashboard/apply.astro",
    "pages/dashboard/feedback.astro",
    "pages/dashboard/leads.astro",
    "pages/dashboard/portfolio.astro",
    "pages/dashboard/profile.astro",
    "pages/dashboard/writing/index.astro",
    ],
  },
  "common/Badge.astro": {
    pattern: /common\/Badge(\.astro)?["']/,
    files: [
    "pages/dashboard/application/[id].astro",
    "pages/dashboard/leads.astro",
    "pages/dashboard/opportunities.astro",
    "pages/dashboard/portfolio.astro",
    "pages/dashboard/writing/index.astro",
    ],
  },
  "the form-control utility": {
    pattern: /\bform-control\b/,
    files: [
    "components/blog/editor/PlainPostForm.astro",
    "components/platform/application/ApplicationAnswers.astro",
    "pages/admin/programs/new.astro",
    "pages/admin/recordings/import.astro",
    "pages/admin/recordings/upload.astro",
    "pages/dashboard/portfolio.astro",
    "pages/dashboard/profile.astro",
    ],
  },
};

function sources(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return sources(path);
    return /\.(astro|tsx?)$/.test(name) && !/\.test\./.test(name) ? [relative(SRC, path)] : [];
  });
}

const FILES = sources(SRC).map((path) => ({ path, text: readFileSync(join(SRC, path), "utf8") }));

describe.each(Object.entries(LEGACY))("%s", (_, { pattern, files }) => {
  const users = FILES.filter(({ text }) => pattern.test(text)).map(({ path }) => path);

  it("is used by no file outside the ones that already did: use the kit in components/platform/ui", () => {
    expect(users.filter((path) => !files.includes(path))).toEqual([]);
  });

  it("lists only files that still use it, so the list shrinks as pages move to the kit", () => {
    expect(files.filter((path) => !users.includes(path))).toEqual([]);
  });
});
