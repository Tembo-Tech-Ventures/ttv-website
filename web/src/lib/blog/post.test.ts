import { describe, expect, it } from "vitest";
import {
  postEditorSchema,
  deriveExcerpt,
  estimateReadingMinutes,
  WORDS_PER_MINUTE,
} from "./post";

describe("postEditorSchema", () => {
  it("accepts valid input", () => {
    const result = postEditorSchema.safeParse({
      title: "Hello World",
      contentMarkdown: "Some content",
    });
    expect(result.success).toBe(true);
  });

  it("rejects missing title", () => {
    const result = postEditorSchema.safeParse({
      contentMarkdown: "Some content",
    });
    expect(result.success).toBe(false);
  });

  it("rejects empty title", () => {
    const result = postEditorSchema.safeParse({
      title: "",
      contentMarkdown: "Some content",
    });
    expect(result.success).toBe(false);
  });

  it("rejects title over 200 characters", () => {
    const result = postEditorSchema.safeParse({
      title: "a".repeat(201),
      contentMarkdown: "Some content",
    });
    expect(result.success).toBe(false);
  });

  it("rejects missing content", () => {
    const result = postEditorSchema.safeParse({
      title: "Hello",
    });
    expect(result.success).toBe(false);
  });

  it("rejects content over 40,000 characters", () => {
    const result = postEditorSchema.safeParse({
      title: "Hello",
      contentMarkdown: "x".repeat(40_001),
    });
    expect(result.success).toBe(false);
  });

  it("accepts content at exactly 40,000 characters", () => {
    const result = postEditorSchema.safeParse({
      title: "Hello",
      contentMarkdown: "x".repeat(40_000),
    });
    expect(result.success).toBe(true);
  });

  it("accepts optional fields when provided", () => {
    const result = postEditorSchema.safeParse({
      title: "Hello",
      contentMarkdown: "Content",
      slug: "custom-slug",
      excerpt: "A short summary",
      coverImageAlt: "Photo of code",
    });
    expect(result.success).toBe(true);
  });
});

describe("deriveExcerpt", () => {
  it("returns plain text from simple markdown", () => {
    expect(deriveExcerpt("Hello world")).toBe("Hello world");
  });

  it("strips headings", () => {
    expect(deriveExcerpt("# Title\n\nBody text")).toBe("Title Body text");
  });

  it("strips bold and italic", () => {
    expect(deriveExcerpt("**bold** and *italic* text")).toBe(
      "bold and italic text"
    );
  });

  it("strips links but keeps link text", () => {
    expect(deriveExcerpt("[click here](https://example.com)")).toBe(
      "click here"
    );
  });

  it("strips images entirely", () => {
    expect(deriveExcerpt("Before ![alt](img.png) after")).toBe("Before after");
  });

  it("strips fenced code blocks", () => {
    expect(deriveExcerpt("Before\n```js\nconst x = 1;\n```\nAfter")).toBe(
      "Before After"
    );
  });

  it("strips inline code backticks", () => {
    expect(deriveExcerpt("Use `npm install`")).toBe("Use npm install");
  });

  it("strips blockquote markers", () => {
    expect(deriveExcerpt("> This is a quote")).toBe("This is a quote");
  });

  it("strips list markers", () => {
    expect(deriveExcerpt("- Item one\n- Item two")).toBe("Item one Item two");
  });

  it("returns empty string for empty input", () => {
    expect(deriveExcerpt("")).toBe("");
  });

  it("returns empty string for whitespace-only input", () => {
    expect(deriveExcerpt("   \n  ")).toBe("");
  });

  it("clips long text at a word boundary with ellipsis", () => {
    const long = "word ".repeat(50);
    const result = deriveExcerpt(long);
    expect(result.length).toBeLessThanOrEqual(161);
    expect(result!.endsWith("…")).toBe(true);
    expect(result).not.toMatch(/\bwor…$/);
  });

  it("keeps text of exactly 160 characters intact", () => {
    const exact = "a ".repeat(79) + "bb";
    expect(exact.length).toBe(160);
    expect(deriveExcerpt(exact)).toBe(exact);
  });

  it("uses custom maxLength when provided", () => {
    const result = deriveExcerpt("word ".repeat(20), 20);
    expect(result.length).toBeLessThanOrEqual(21);
  });
});

describe("estimateReadingMinutes", () => {
  it("returns 1 for an empty string", () => {
    expect(estimateReadingMinutes("")).toBe(1);
  });

  it("returns 1 for a short post", () => {
    expect(estimateReadingMinutes("Hello world")).toBe(1);
  });

  it("returns 1 for exactly 200 words", () => {
    expect(estimateReadingMinutes("word ".repeat(WORDS_PER_MINUTE))).toBe(1);
  });

  it("returns 2 for 201 words", () => {
    expect(
      estimateReadingMinutes("word ".repeat(WORDS_PER_MINUTE) + "extra")
    ).toBe(2);
  });

  it("returns 2 for exactly 400 words", () => {
    expect(
      estimateReadingMinutes("word ".repeat(WORDS_PER_MINUTE * 2))
    ).toBe(2);
  });

  it("returns 3 for 401 words", () => {
    expect(
      estimateReadingMinutes("word ".repeat(WORDS_PER_MINUTE * 2) + "extra")
    ).toBe(3);
  });

  it("uses ceil, not round or floor", () => {
    expect(
      estimateReadingMinutes("word ".repeat(WORDS_PER_MINUTE + 1))
    ).toBe(2);
  });
});
