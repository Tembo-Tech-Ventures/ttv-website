import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { KIT_RULES } from "./kit-compliance.rules";

const SRC = resolve(import.meta.dirname, "..");
const ROOTS = ["pages", "components"];

function sources(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return name === "_tests" ? [] : sources(path);
    return /\.(astro|tsx?|css)$/.test(name) && !/\.test\./.test(name) ? [relative(SRC, path)] : [];
  });
}

/** Every rule's count per file under src/pages and src/components, leaving out files with none. */
export function scanKitCompliance(): Record<string, Record<string, number>> {
  const files = ROOTS.flatMap((root) => sources(join(SRC, root))).toSorted().map((path) => ({ path, text: readFileSync(join(SRC, path), "utf8") }));
  return Object.fromEntries(Object.entries(KIT_RULES).map(([name, rule]) => {
    const counts: Record<string, number> = {};
    for (const { path, text } of files) {
      if (rule.applies && !rule.applies(path)) continue;
      const count = text.match(rule.pattern)?.length ?? 0;
      if (count > 0) counts[path] = count;
    }
    return [name, counts];
  }));
}
