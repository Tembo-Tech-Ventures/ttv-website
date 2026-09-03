import { describe, expect, it } from "vitest";
import { renderPostHtml, POST_RENDER_VERSION, POST_SANITIZE_SCHEMA } from "./render";

describe("POST_RENDER_VERSION", () => {
  it("is version 1", () => {
    expect(POST_RENDER_VERSION).toBe(1);
  });
});

describe("POST_SANITIZE_SCHEMA", () => {
  it("does not allow h1 (headings are shifted)", () => {
    expect(POST_SANITIZE_SCHEMA.tagNames).not.toContain("h1");
    expect(POST_SANITIZE_SCHEMA.tagNames).toContain("h2");
  });

  it("does not allow img (no inline images in v1)", () => {
    expect(POST_SANITIZE_SCHEMA.tagNames).not.toContain("img");
  });

  it("does not allow script or iframe", () => {
    expect(POST_SANITIZE_SCHEMA.tagNames).not.toContain("script");
    expect(POST_SANITIZE_SCHEMA.tagNames).not.toContain("iframe");
    expect(POST_SANITIZE_SCHEMA.tagNames).not.toContain("object");
    expect(POST_SANITIZE_SCHEMA.tagNames).not.toContain("embed");
  });

  it("only allows safe href protocols", () => {
    expect(POST_SANITIZE_SCHEMA.protocols!.href).toEqual([
      "http",
      "https",
      "mailto",
    ]);
  });

  it("strips script and style content entirely", () => {
    expect(POST_SANITIZE_SCHEMA.strip).toContain("script");
    expect(POST_SANITIZE_SCHEMA.strip).toContain("style");
  });
});

describe("renderPostHtml", () => {
  // ─── Basic rendering ────────────────────────────────────

  it("renders a paragraph", async () => {
    const html = await renderPostHtml("Hello world");
    expect(html).toBe("<p>Hello world</p>");
  });

  it("renders bold and italic", async () => {
    const html = await renderPostHtml("**bold** and *italic*");
    expect(html).toBe("<p><strong>bold</strong> and <em>italic</em></p>");
  });

  it("renders a link", async () => {
    const html = await renderPostHtml(
      "[click](https://tembotechventures.com/about)"
    );
    expect(html).toBe(
      '<p><a href="https://tembotechventures.com/about">click</a></p>'
    );
  });

  it("renders inline code", async () => {
    const html = await renderPostHtml("Use `npm install`");
    expect(html).toBe("<p>Use <code>npm install</code></p>");
  });

  it("renders a blockquote", async () => {
    const html = await renderPostHtml("> A wise saying");
    expect(html).toContain("<blockquote>");
    expect(html).toContain("A wise saying");
  });

  it("renders unordered lists", async () => {
    const html = await renderPostHtml("- One\n- Two\n- Three");
    expect(html).toContain("<ul>");
    expect(html).toContain("<li>One</li>");
  });

  it("renders ordered lists", async () => {
    const html = await renderPostHtml("1. First\n2. Second");
    expect(html).toContain("<ol>");
    expect(html).toContain("<li>First</li>");
  });

  // ─── GFM features ──────────────────────────────────────

  it("renders GFM tables", async () => {
    const html = await renderPostHtml(
      "| A | B |\n| --- | --- |\n| 1 | 2 |"
    );
    expect(html).toContain("<table>");
    expect(html).toContain("<th>A</th>");
    expect(html).toContain("<td>1</td>");
  });

  it("renders strikethrough", async () => {
    const html = await renderPostHtml("~~deleted~~");
    expect(html).toBe("<p><del>deleted</del></p>");
  });

  it("renders task list checkboxes as disabled", async () => {
    const html = await renderPostHtml("- [x] Done\n- [ ] Not done");
    expect(html).toContain("disabled");
    expect(html).toContain("checked");
    expect(html).toContain("Done");
    expect(html).toContain("Not done");
  });

  // ─── Heading shift ─────────────────────────────────────

  it("shifts h1 → h2", async () => {
    const html = await renderPostHtml("# Title");
    expect(html).toBe("<h2>Title</h2>");
    expect(html).not.toContain("<h1>");
  });

  it("shifts h2 → h3", async () => {
    const html = await renderPostHtml("## Subtitle");
    expect(html).toBe("<h3>Subtitle</h3>");
  });

  it("shifts h3 → h4", async () => {
    const html = await renderPostHtml("### Section");
    expect(html).toBe("<h4>Section</h4>");
  });

  it("caps at h6 (h6 stays h6)", async () => {
    const html = await renderPostHtml("###### Tiny");
    expect(html).toBe("<h6>Tiny</h6>");
  });

  // ─── External links ────────────────────────────────────

  it("adds rel and target to external links", async () => {
    const html = await renderPostHtml("[go](https://example.com)");
    expect(html).toContain('rel="nofollow ugc noopener noreferrer"');
    expect(html).toContain('target="_blank"');
    expect(html).toContain("go");
  });

  it("leaves internal links untouched", async () => {
    const html = await renderPostHtml(
      "[home](https://tembotechventures.com/blog)"
    );
    expect(html).not.toContain("nofollow");
    expect(html).not.toContain("target=");
    expect(html).toContain("home");
  });

  it("leaves www.tembotechventures.com links untouched", async () => {
    const html = await renderPostHtml(
      "[home](https://www.tembotechventures.com)"
    );
    expect(html).not.toContain("nofollow");
  });

  it("leaves relative links untouched", async () => {
    const html = await renderPostHtml("[next](/blog/amina/next-post)");
    expect(html).not.toContain("nofollow");
    expect(html).toContain('href="/blog/amina/next-post"');
  });

  it("leaves mailto links untouched", async () => {
    const html = await renderPostHtml("[email](mailto:test@example.com)");
    expect(html).not.toContain("nofollow");
    expect(html).toContain("mailto:test@example.com");
  });

  // ─── XSS: tag injection ────────────────────────────────
  // allowDangerousHtml: false drops raw HTML nodes from the remark AST.
  // rehype-sanitize is the second barrier.

  it("strips <script> tags", async () => {
    const html = await renderPostHtml(
      "Before\n\n<script>alert(1)</script>\n\nAfter"
    );
    expect(html).not.toContain("<script>");
    expect(html).not.toContain("alert(1)");
    expect(html).toContain("Before");
    expect(html).toContain("After");
  });

  it("strips inline <script> tags (text content is harmless without the tag)", async () => {
    const html = await renderPostHtml(
      "Hello <script>alert(1)</script> World"
    );
    expect(html).not.toContain("<script>");
    expect(html).toContain("Hello");
    expect(html).toContain("World");
  });

  it("strips <img onerror>", async () => {
    const html = await renderPostHtml(
      'Before\n\n<img onerror="alert(1)" src="x">\n\nAfter'
    );
    expect(html).not.toContain("<img");
    expect(html).not.toContain("onerror");
    expect(html).toContain("Before");
    expect(html).toContain("After");
  });

  it("strips <iframe>", async () => {
    const html = await renderPostHtml(
      'Before\n\n<iframe src="https://evil.com"></iframe>\n\nAfter'
    );
    expect(html).not.toContain("<iframe");
    expect(html).toContain("Before");
    expect(html).toContain("After");
  });

  it("strips <svg onload>", async () => {
    const html = await renderPostHtml(
      'Before\n\n<svg onload="alert(1)"></svg>\n\nAfter'
    );
    expect(html).not.toContain("<svg");
    expect(html).not.toContain("onload");
    expect(html).toContain("Before");
    expect(html).toContain("After");
  });

  // ─── XSS: URL scheme injection ─────────────────────────
  // allowDangerousHtml: false does NOT block these — rehype-sanitize's
  // protocol allowlist is the sole defense here.
  /* eslint-disable no-script-url */

  it("strips javascript: from a markdown link", async () => {
    const html = await renderPostHtml("[click](javascript:alert(1))");
    expect(html).not.toContain("javascript:");
    expect(html).toContain("click");
  });

  it("strips href from a CommonMark autolink with javascript: scheme", async () => {
    const html = await renderPostHtml("<javascript:alert(1)>");
    expect(html).not.toContain('href="javascript:');
    expect(html).not.toContain("href='javascript:");
  });

  it("strips javascript: from a reference link", async () => {
    const html = await renderPostHtml(
      "[click][1]\n\n[1]: javascript:alert(1)"
    );
    expect(html).not.toContain("javascript:");
    expect(html).toContain("click");
  });

  it("strips entity-encoded javascript:", async () => {
    const html = await renderPostHtml(
      "[click](javas&#99;ript:alert(1))"
    );
    expect(html).not.toContain("javascript:");
    expect(html).toContain("click");
  });

  it("strips mixed-case JaVaScRiPt:", async () => {
    const html = await renderPostHtml("[click](JaVaScRiPt:alert(1))");
    expect(html).not.toContain("javascript:");
    expect(html).not.toContain("JaVaScRiPt:");
    expect(html).toContain("click");
  });

  it("strips data: URI scheme", async () => {
    const html = await renderPostHtml(
      "[click](data:text/html,<script>alert(1)</script>)"
    );
    expect(html).not.toContain("data:");
    expect(html).toContain("click");
  });

  it("strips vbscript: URI scheme", async () => {
    const html = await renderPostHtml("[click](vbscript:MsgBox(1))");
    expect(html).not.toContain("vbscript:");
    expect(html).toContain("click");
  });

  /* eslint-enable no-script-url */

  // ─── Code blocks: safe rendering ───────────────────────

  it("escapes <script> inside fenced code blocks and keeps it visible", async () => {
    const html = await renderPostHtml(
      "```html\n<script>alert(1)</script>\n```"
    );
    expect(html).not.toContain("<script>");
    expect(html).toContain("&#x3C;script>");
    expect(html).toContain("alert(1)");
    expect(html).toContain("<pre>");
    expect(html).toContain("<code");
  });

  it("preserves fenced code content with angle brackets", async () => {
    const html = await renderPostHtml(
      "```tsx\nconst App = () => <div>Hello</div>;\n```"
    );
    expect(html).toContain("&#x3C;div>");
    expect(html).toContain("Hello");
  });

  // ─── Return type ───────────────────────────────────────

  it("returns a string (branded as RenderedHtml at compile time)", async () => {
    const html = await renderPostHtml("test");
    expect(typeof html).toBe("string");
  });

  it("returns empty output for empty input", async () => {
    const html = await renderPostHtml("");
    expect(html).toBe("");
  });
});
