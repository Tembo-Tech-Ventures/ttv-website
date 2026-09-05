import { describe, expect, it } from "vitest";
import {
  absoluteUrl,
  normalizeDescription,
  pageTitle,
  DEFAULT_DESCRIPTION,
  SITE_NAME,
} from "./seo";

const SITE = new URL("https://tembotechventures.com");

describe("absoluteUrl", () => {
  it("resolves a root-relative path against the site origin", () => {
    expect(absoluteUrl(SITE, "/blog/amina/hello")).toBe(
      "https://tembotechventures.com/blog/amina/hello"
    );
  });

  it("preserves an already-absolute https URL unchanged", () => {
    expect(absoluteUrl(SITE, "https://example.com/post")).toBe(
      "https://example.com/post"
    );
  });

  it("preserves an already-absolute http URL unchanged", () => {
    expect(absoluteUrl(SITE, "http://example.com/post")).toBe(
      "http://example.com/post"
    );
  });

  it("matches the scheme case-insensitively", () => {
    expect(absoluteUrl(SITE, "HTTPS://example.com/post")).toBe(
      "HTTPS://example.com/post"
    );
  });

  it("keeps query strings and fragments", () => {
    expect(absoluteUrl(SITE, "/talent?skill=react#top")).toBe(
      "https://tembotechventures.com/talent?skill=react#top"
    );
  });

  it("preserves a trailing slash rather than normalizing it away", () => {
    expect(absoluteUrl(SITE, "/blog/")).toBe(
      "https://tembotechventures.com/blog/"
    );
  });

  it("returns null for undefined, empty, and whitespace-only input", () => {
    expect(absoluteUrl(SITE, undefined)).toBeNull();
    expect(absoluteUrl(SITE, "")).toBeNull();
    expect(absoluteUrl(SITE, "   ")).toBeNull();
  });

  it("returns null for a relative path when no site origin is configured", () => {
    expect(absoluteUrl(undefined, "/blog")).toBeNull();
  });

  it("still resolves an absolute URL when no site origin is configured", () => {
    expect(absoluteUrl(undefined, "https://example.com/x")).toBe(
      "https://example.com/x"
    );
  });
});

describe("normalizeDescription", () => {
  it("returns undefined for undefined so the caller can fall back", () => {
    expect(normalizeDescription(undefined)).toBeUndefined();
  });

  it("returns undefined for whitespace-only input", () => {
    expect(normalizeDescription("   \n  ")).toBeUndefined();
  });

  it("collapses newlines and runs of whitespace into single spaces", () => {
    expect(normalizeDescription("A post\n\nabout   testing")).toBe(
      "A post about testing"
    );
  });

  it("passes a short description through byte-for-byte", () => {
    expect(normalizeDescription("Short and sweet.")).toBe("Short and sweet.");
  });

  // Boundary trio: 160 is kept whole, 161 must clip. A "roughly truncates"
  // assertion would survive an off-by-one mutant.
  it("keeps a description of exactly 160 characters intact", () => {
    const exact = "a".repeat(160);
    expect(normalizeDescription(exact)).toBe(exact);
    expect(normalizeDescription(exact)).toHaveLength(160);
  });

  it("clips at 161 characters and appends an ellipsis", () => {
    const over = `${"word ".repeat(40)}tail`; // 204 chars
    const result = normalizeDescription(over);
    expect(result).toBeDefined();
    expect(result!.endsWith("…")).toBe(true);
    expect(result!.length).toBeLessThanOrEqual(161); // 160 + the ellipsis
    expect(result).toContain("word");
    // Clipped on a word boundary, so no dangling partial word before the ellipsis.
    expect(result).not.toMatch(/\bwor…$/);
  });

  it("clips a single unbroken word that exceeds the limit", () => {
    const result = normalizeDescription("x".repeat(300));
    expect(result).toBe(`${"x".repeat(160)}…`);
  });

  it("strips trailing punctuation before the ellipsis", () => {
    const result = normalizeDescription(`${"word ".repeat(31)}sentence. tail`);
    expect(result).toBeDefined();
    expect(result).not.toContain(".…");
  });
});

describe("pageTitle", () => {
  it("falls back to the site name when no title is given", () => {
    expect(pageTitle(undefined)).toBe(SITE_NAME);
    expect(pageTitle("")).toBe(SITE_NAME);
    expect(pageTitle("   ")).toBe(SITE_NAME);
  });

  it("leaves an already-composed title alone", () => {
    expect(pageTitle("Talent · Tembo Tech Ventures")).toBe(
      "Talent · Tembo Tech Ventures"
    );
  });

  it("does not double up when the title is exactly the site name", () => {
    expect(pageTitle(SITE_NAME)).toBe(SITE_NAME);
  });

  it("appends the site name to a bare title", () => {
    expect(pageTitle("How I learned to test")).toBe(
      "How I learned to test · Tembo Tech Ventures"
    );
  });

  it("trims surrounding whitespace before composing", () => {
    expect(pageTitle("  Field notes  ")).toBe(
      "Field notes · Tembo Tech Ventures"
    );
  });
});

describe("DEFAULT_DESCRIPTION", () => {
  // The site-wide description is user-facing copy; the community/ecosystem
  // framing is deliberate and should not drift into savior language.
  it("keeps the Africa focus", () => {
    expect(DEFAULT_DESCRIPTION).toContain("Africa");
  });
});
