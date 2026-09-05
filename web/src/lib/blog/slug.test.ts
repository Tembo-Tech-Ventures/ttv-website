import { describe, expect, it } from "vitest";
import {
  slugifyTitle,
  validateSlug,
  RESERVED_POST_SLUGS,
} from "./slug";

describe("slugifyTitle", () => {
  it("lowercases and hyphenates a plain title", () => {
    expect(slugifyTitle("Hello World")).toBe("hello-world");
  });

  it("strips special characters", () => {
    expect(slugifyTitle("What's new in TypeScript 5.0?")).toBe(
      "whats-new-in-typescript-50"
    );
  });

  it("preserves unicode characters", () => {
    const slug = slugifyTitle("Café au lait");
    expect(slug).toBe("café-au-lait");
  });

  it("trims to 80 characters on a hyphen boundary", () => {
    const longTitle = "this is a very long title " + "word ".repeat(30);
    const slug = slugifyTitle(longTitle);
    expect(slug.length).toBeLessThanOrEqual(80);
    expect(slug.endsWith("-")).toBe(false);
  });

  it("returns a valid slug even for a single very long word", () => {
    const slug = slugifyTitle("a".repeat(200));
    expect(slug.length).toBeLessThanOrEqual(80);
  });

  it("produces unique output for different titles", () => {
    expect(slugifyTitle("First Post")).not.toBe(slugifyTitle("Second Post"));
  });
});

describe("validateSlug", () => {
  it("accepts valid slugs", () => {
    expect(validateSlug("hello-world")).toEqual({ ok: true });
    expect(validateSlug("a")).toEqual({ ok: true });
    expect(validateSlug("post-2026")).toEqual({ ok: true });
    expect(validateSlug("a".repeat(80))).toEqual({ ok: true });
  });

  it("rejects empty slugs", () => {
    expect(validateSlug("")).toEqual({ ok: false, error: "too_short" });
  });

  it("rejects slugs over 80 characters", () => {
    expect(validateSlug("a".repeat(81))).toEqual({
      ok: false,
      error: "too_long",
    });
  });

  it("rejects uppercase characters", () => {
    expect(validateSlug("Hello")).toEqual({
      ok: false,
      error: "invalid_chars",
    });
  });

  it("rejects underscores", () => {
    expect(validateSlug("hello_world")).toEqual({
      ok: false,
      error: "invalid_chars",
    });
  });

  it("rejects leading or trailing hyphens", () => {
    expect(validateSlug("-leading")).toEqual({
      ok: false,
      error: "invalid_chars",
    });
    expect(validateSlug("trailing-")).toEqual({
      ok: false,
      error: "invalid_chars",
    });
  });

  it("rejects double hyphens", () => {
    expect(validateSlug("has--double")).toEqual({
      ok: false,
      error: "double_hyphen",
    });
  });

  it("rejects all reserved post slugs", () => {
    for (const slug of RESERVED_POST_SLUGS) {
      expect(validateSlug(slug)).toEqual({ ok: false, error: "reserved" });
    }
  });

  it("RESERVED_POST_SLUGS contains the expected entries", () => {
    const expected = ["new", "edit", "delete", "draft", "drafts"];
    for (const s of expected) {
      expect(RESERVED_POST_SLUGS.has(s)).toBe(true);
    }
  });
});
