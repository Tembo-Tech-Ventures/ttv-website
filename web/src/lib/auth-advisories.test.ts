import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Keep TTV's deliberately small auth surface explicit after the 1.7 upgrade.
 * The four former audit exceptions are fixed and no longer allowlisted;
 * adding a provider/plugin or database rate limiting still needs review.
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

describe("better-auth reviewed feature surface", () => {
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

/**
 * First patched version per locked package, from the advisories the 1.7
 * upgrade retired. npm audit (and scripts/audit-ci.mjs, which fails only on
 * high/critical) would not stop a downgrade that brings back the low-severity
 * GHSA-44jh-23m7-hpcf, so the lockfile itself must stay above every fix.
 */
const PATCHED_FLOORS: Record<string, { version: string; advisories: string[] }> = {
  "better-auth": {
    version: "1.7.7",
    advisories: ["GHSA-q84f-53jg-9ppm", "GHSA-r4xp-prcw-77qf", "GHSA-965c-763c-88jm", "GHSA-44jh-23m7-hpcf"],
  },
  "@better-auth/drizzle-adapter": { version: "1.7.7", advisories: ["GHSA-44jh-23m7-hpcf"] },
  "@better-auth/kysely-adapter": { version: "1.7.0", advisories: ["GHSA-44jh-23m7-hpcf"] },
};

type LockedPackages = Record<string, { version?: string }>;

function stableVersion(version: string): [number, number, number] {
  const match = /^(\d+)\.(\d+)\.(\d+)$/.exec(version);
  if (!match) throw new Error(`expected a stable release, got ${version}`);
  return [Number(match[1]), Number(match[2]), Number(match[3])];
}

function isAtLeast(version: string, floor: string): boolean {
  const actual = stableVersion(version);
  const minimum = stableVersion(floor);
  for (let i = 0; i < 3; i++) {
    if (actual[i] !== minimum[i]) return actual[i] > minimum[i];
  }
  return true;
}

/** Every locked copy of a package, including nested ones, with its version. */
function lockedCopies(packages: LockedPackages, name: string) {
  return Object.entries(packages)
    .filter(([path]) => path === `node_modules/${name}` || path.endsWith(`/node_modules/${name}`))
    .map(([path, entry]) => ({ path, version: entry.version ?? "" }));
}

describe("locked better-auth versions", () => {
  const lock = JSON.parse(readFileSync(resolve(SRC, "../package-lock.json"), "utf8")) as { packages: LockedPackages };

  it.each(Object.entries(PATCHED_FLOORS))("locks %s at or above its patched release", (name, floor) => {
    const copies = lockedCopies(lock.packages, name);
    expect(copies.length).toBeGreaterThan(0);
    for (const { path, version } of copies) {
      expect(isAtLeast(version, floor.version), `${path}@${version} reopens ${floor.advisories.join(", ")}`).toBe(true);
    }
  });

  it("resolves every @better-auth package to the same release as better-auth", () => {
    const [core] = lockedCopies(lock.packages, "better-auth");
    const split = Object.entries(lock.packages)
      .filter(([path]) => /(^|\/)node_modules\/@better-auth\/[^/]+$/.test(path))
      .filter(([path]) => !path.endsWith("/utils"))
      .filter(([, entry]) => entry.version !== core.version)
      .map(([path, entry]) => `${path}@${entry.version}`);
    expect(split).toEqual([]);
  });

  it("compares versions numerically and refuses prereleases", () => {
    expect(isAtLeast("1.7.15", "1.7.7")).toBe(true);
    expect(isAtLeast("1.7.7", "1.7.7")).toBe(true);
    expect(isAtLeast("1.7.6", "1.7.7")).toBe(false);
    expect(isAtLeast("1.6.33", "1.7.0")).toBe(false);
    expect(isAtLeast("2.0.0", "1.7.7")).toBe(true);
    expect(() => isAtLeast("1.7.0-rc.6", "1.7.0")).toThrow(/stable release/);
  });
});
