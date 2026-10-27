import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * scripts/audit-ci.mjs allowlists four better-auth advisories (fixed only in
 * the breaking 1.7 line) because each needs a feature TTV does not use. These
 * checks keep that true: enabling any of those features fails here first, and
 * the advisory must then be fixed by upgrading rather than allowlisted.
 */
const SRC = resolve(__dirname, "..");
const AFFECTED_PLUGINS = ["deviceAuthorization", "oauthProxy", "magicLink"];

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return sourceFiles(path);
    return /\.(ts|tsx|astro|mjs)$/.test(name) && !name.endsWith(".test.ts") ? [path] : [];
  });
}

describe("better-auth features behind allowlisted advisories", () => {
  const auth = readFileSync(join(SRC, "lib/auth.ts"), "utf8");

  it("enables only the bearer plugin", () => {
    const imported = [...auth.matchAll(/import\s*{([^}]+)}\s*from\s*"better-auth\/plugins"/g)].flatMap((match) =>
      match[1].split(",").map((name) => name.trim()).filter(Boolean),
    );
    expect(imported).toEqual(["bearer"]);
  });

  it("does not use the device login, OAuth Proxy or Magic Link plugins anywhere", () => {
    const offenders = sourceFiles(SRC).filter((file) => {
      const source = readFileSync(file, "utf8");
      return AFFECTED_PLUGINS.some((plugin) => new RegExp(`\\b${plugin}\\s*\\(`).test(source));
    });
    expect(offenders).toEqual([]);
  });

  it("keeps rate-limit records out of the database", () => {
    expect(auth).not.toMatch(/rateLimit/);
  });
});
