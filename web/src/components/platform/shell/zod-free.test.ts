import { existsSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

/*
 * The spaces shell is on every signed-in page, so what it imports is what every page downloads. zod
 * and the contract module (about 26 KB and 6 KB gzipped) stay on the server: the shell's client code
 * takes contract types only, and its runtime checks from space-order.ts and draft-keys.ts (S6).
 * This walks the shell's own static imports (type-only imports and dynamic import() excluded) and
 * fails if either comes back.
 */
const SRC = path.resolve(__dirname, "../../..");
const ENTRIES = ["components/platform/shell/SpacesShell.tsx"];
const FORBIDDEN = [/^zod(\/|$)/, /lib\/platform\/contracts(\.ts)?$/];

function resolve(from: string, specifier: string): string | null {
  const base = specifier.startsWith("@/") ? path.join(SRC, specifier.slice(2))
    : specifier.startsWith(".") ? path.resolve(path.dirname(from), specifier) : null;
  if (!base) return null;
  return [base, `${base}.ts`, `${base}.tsx`, path.join(base, "index.ts")]
    .find((candidate) => existsSync(candidate) && statSync(candidate).isFile()) ?? null;
}

/** Static value imports: `import x from`, `import { a, type B } from` (unless every name is a type), `export … from`, bare imports. */
function valueImports(source: string): string[] {
  const found: string[] = [];
  for (const match of source.matchAll(/^\s*(import|export)\s+(type\s+)?([^'";]*?)\s*from\s*["']([^"']+)["']/gm)) {
    const [, , typeOnly, clause, specifier] = match;
    if (typeOnly) continue;
    const names = /^\{([^}]*)\}$/.exec(clause!.trim())?.[1];
    if (names !== undefined && names.split(",").map((name) => name.trim()).filter(Boolean).every((name) => name.startsWith("type "))) continue;
    found.push(specifier!);
  }
  for (const match of source.matchAll(/^\s*import\s+["']([^"']+)["']/gm)) found.push(match[1]!);
  return found;
}

function graph(): Map<string, string[]> {
  const edges = new Map<string, string[]>();
  const queue = ENTRIES.map((entry) => path.join(SRC, entry));
  while (queue.length > 0) {
    const file = queue.shift()!;
    if (edges.has(file)) continue;
    const specifiers = valueImports(readFileSync(file, "utf8"));
    edges.set(file, specifiers);
    for (const specifier of specifiers) {
      const next = resolve(file, specifier);
      if (next && /\.tsx?$/.test(next)) queue.push(next);
    }
  }
  return edges;
}

describe("the spaces shell's client code", () => {
  it("reaches neither zod nor the contract module at runtime", () => {
    const offenders: string[] = [];
    for (const [file, specifiers] of graph()) {
      for (const specifier of specifiers) {
        const target = resolve(file, specifier) ?? specifier;
        if (FORBIDDEN.some((pattern) => pattern.test(specifier) || pattern.test(target))) offenders.push(`${path.relative(SRC, file)} → ${specifier}`);
      }
    }
    expect(offenders).toEqual([]);
  });

  it("walks the shell for real: the account menu and space selection are in it", () => {
    const files = [...graph().keys()].map((file) => path.relative(SRC, file));
    expect(files).toEqual(expect.arrayContaining([
      "components/platform/shell/AccountMenu.tsx", "lib/platform/client/spaces.ts", "lib/platform/client/spaces-selection.ts",
      "lib/platform/client/draft-keys.ts", "lib/platform/space-order.ts",
    ]));
  });
});
