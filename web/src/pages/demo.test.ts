import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const source = readFileSync(new URL("./demo.astro", import.meta.url), "utf8");

describe("demo page integration boundary", () => {
  it("requires the real server operator gate before exposing the client island", () => {
    expect(source).toContain('from "@/lib/staging-demo-access"');
    expect(source).toContain("await demoOperator(env, Astro.request)");
    expect(source).toContain("let expiresAt: string | null = null");
    expect(source.indexOf("await demoOperator")).toBeLessThan(source.indexOf("expiresAt = new Date"));
    expect(source).toContain("{expiresAt ? (");
    expect(source).toContain("error instanceof DemoAccessError ? error.status : 503");
  });
  it("passes only safe explicit props and never guesses an active persona", () => {
    const island = source.match(/<DemoAccessApp[^>]+\/>/)?.[0];
    expect(island).toBeDefined();
    expect(island).toContain('activePersona={null} displayName="Demo operator"');
    expect(island).toContain("expiresAt={expiresAt}");
    expect(island).not.toMatch(/operator\.|session|cookieValue|\.\.\./);
  });
  it("prevents caching/indexing and provides no public role controls on failure", () => {
    expect(source).toContain('Astro.response.headers.set("Cache-Control", "no-store")');
    expect(source).toContain('title="Demo access | TTV" noIndex');
    const unavailable = source.slice(source.indexOf("Demo access is unavailable"));
    expect(unavailable).not.toContain("DemoAccessApp");
    expect(unavailable).not.toContain("<button");
    expect(unavailable).not.toContain("/api/demo");
  });
});
