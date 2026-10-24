import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import config from "../../playwright.config.ts";

describe("authenticated live browser evidence policy", () => {
  it("disables retained traces in every live project", () => {
    expect(config.use?.trace).toBe("off");
    for (const project of config.projects ?? []) expect(project.use?.trace ?? config.use?.trace).toBe("off");
  });
  it("routes authenticated direct API calls through the credential-safe boundary", () => {
    const directory = new URL("../../e2e/", import.meta.url);
    for (const file of readdirSync(directory).filter(name => name.endsWith(".spec.ts"))) {
      const source = readFileSync(new URL(file, directory), "utf8");
      if (!source.includes("Authorization:")) continue;
      // Anonymous attachment access deliberately exercises the signed-out path.
      const withoutAnonymous = source.replace(/anonymous\.request\.get\([^;]+;/g, "");
      expect(withoutAnonymous).not.toMatch(/\b(?:request|api)\.(?:get|post|put|patch|delete|head|fetch)\s*\(/);
      expect(source).not.toMatch(/trace:\s*["'](?:on|retain-on-failure|on-first-retry)["']/);
    }
  });
});
