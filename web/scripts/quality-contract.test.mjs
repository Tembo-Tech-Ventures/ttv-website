import { readFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";

const webRoot = path.resolve(import.meta.dirname, "..");

async function readWebFile(relativePath) {
  return readFile(path.join(webRoot, relativePath), "utf8");
}

describe("repository quality contract", () => {
  it("exposes one complete local quality command with zero-warning lint", async () => {
    const packageJson = JSON.parse(await readWebFile("package.json"));

    expect(packageJson.scripts.lint).toContain("--max-warnings 0");
    expect(packageJson.scripts["format:check"]).toBe("prettier --check .");
    expect(packageJson.scripts.typecheck).toContain("typecheck:astro");
    expect(packageJson.scripts["test:coverage"]).toContain("--coverage");
    expect(packageJson.scripts.quality).toContain("format:check");
    expect(packageJson.scripts.quality).toContain("audit:ci");
  });

  it("uses strictest TypeScript and typed, accessible lint presets", async () => {
    const [tsconfig, eslintConfig] = await Promise.all([
      readWebFile("tsconfig.json"),
      readWebFile("eslint.config.js"),
    ]);

    expect(JSON.parse(tsconfig).extends).toBe("astro/tsconfigs/strictest");
    expect(eslintConfig).toContain("strictTypeChecked");
    expect(eslintConfig).toContain("stylisticTypeChecked");
    expect(eslintConfig).toContain('configs["flat/jsx-a11y-strict"]');
    expect(eslintConfig).toContain('configs.flat["recommended-latest"]');
    expect(eslintConfig).toContain('"@typescript-eslint/no-explicit-any": "error"');
  });

  it("enforces global and elevated critical-chat coverage floors", async () => {
    const vitestConfig = await readWebFile("vitest.config.ts");

    expect(vitestConfig).toContain("statements: 67");
    expect(vitestConfig).toContain("branches: 64");
    expect(vitestConfig).toContain("functions: 54");
    expect(vitestConfig).toContain("lines: 69");
    expect(vitestConfig).toContain(
      '"src/lib/chat/{contracts,prompt,retrieval,service,stream}.ts"'
    );
    expect(vitestConfig).toContain("statements: 85");
    expect(vitestConfig).toContain("lines: 85");
  });
});
