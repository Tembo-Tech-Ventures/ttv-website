/**
 * Round-trip fidelity for the rich editor.
 *
 * The editor is a lens over Markdown that is stored in the database, so every
 * test here asks the same question: if an author opens a post and saves it
 * without touching anything, does the published page change? A silent "yes" is
 * the worst failure this feature has — the work looks intact on screen while
 * the stored copy quietly loses a table.
 *
 * The assertion is deliberately made against rendered HTML rather than against
 * the Markdown string. The editor does rewrite punctuation — `* item` comes
 * back as `- item`, `_word_` as `*word*` — and a string comparison would fail
 * on those while missing the differences that actually matter.
 */
import { createHeadlessEditor } from "@lexical/headless";
import {
  $convertFromMarkdownString,
  $convertToMarkdownString,
} from "@lexical/markdown";
import { $getRoot } from "lexical";
import { describe, expect, it } from "vitest";
import { renderPostHtml } from "@/lib/blog/render";
import { POST_TRANSFORMERS } from "./markdown";
import { POST_EDITOR_NODES } from "./nodes";

/** Markdown in, editor state, Markdown out — exactly what the editor does. */
function roundTrip(markdown: string): string {
  const editor = createHeadlessEditor({
    namespace: "post-editor-test",
    nodes: POST_EDITOR_NODES,
    onError: (error) => {
      throw error;
    },
  });

  let output = "";
  editor.update(
    () => {
      $convertFromMarkdownString(markdown, POST_TRANSFORMERS);
    },
    { discrete: true }
  );
  editor.getEditorState().read(() => {
    output = $convertToMarkdownString(POST_TRANSFORMERS);
  });
  return output;
}

async function expectPublishesTheSame(markdown: string) {
  const before = await renderPostHtml(markdown);
  const after = await renderPostHtml(roundTrip(markdown));
  expect(after).toBe(before);
  // A transformer that swallowed the body would also make both sides equal.
  expect(before).not.toBe("");
}

/** Every text format the editor ends up holding for a piece of Markdown. */
function formatsIn(markdown: string): string[] {
  const editor = createHeadlessEditor({
    namespace: "post-editor-test",
    nodes: POST_EDITOR_NODES,
    onError: (error) => {
      throw error;
    },
  });

  const formats = new Set<string>();
  editor.update(
    () => {
      $convertFromMarkdownString(markdown, POST_TRANSFORMERS);
    },
    { discrete: true }
  );
  editor.getEditorState().read(() => {
    for (const node of $getRoot().getAllTextNodes()) {
      for (const format of TEXT_FORMATS) {
        if (node.hasFormat(format)) formats.add(format);
      }
    }
  });
  return [...formats];
}

const TEXT_FORMATS = [
  "bold",
  "italic",
  "strikethrough",
  "underline",
  "code",
  "subscript",
  "superscript",
  "highlight",
] as const;

const POST = [
  "We spent the first week talking to people instead of writing code.",
  "",
  "# What we heard",
  "",
  "Three things came up in **every** conversation:",
  "",
  "- The current tool is slow.",
  "- Nobody trusts the numbers in it.",
  "- Everyone keeps a spreadsheet on the side.",
  "",
  "> The spreadsheet is the product. The tool is the invoice.",
  "",
  "## What we changed",
  "",
  "We cut the roadmap to the one workflow those quotes justified, and wrote it",
  "down in [the plan](https://example.com/plan).",
  "",
  "```ts",
  "const scope = features.filter(isJustifiedByAQuote);",
  "```",
  "",
  "---",
  "",
  "Next week: ten more conversations.",
].join("\n");

describe("what the editor can hold", () => {
  const SUPPORTED: Array<[string, string]> = [
    ["a paragraph", "Just a sentence about something."],
    ["two paragraphs", "First paragraph.\n\nSecond paragraph."],
    ["headings", "# Section\n\nBody.\n\n## Subsection\n\nMore.\n\n### Deeper"],
    ["bold", "A **bold** claim."],
    ["italic", "An *emphatic* claim."],
    ["bold italic", "A ***loud*** claim."],
    ["strikethrough", "A ~~retracted~~ claim."],
    ["inline code", "Call `renderPostHtml` first."],
    ["a link", "Read [the docs](https://example.com/docs)."],
    ["a bulleted list", "- first\n- second\n- third"],
    ["a numbered list", "1. first\n2. second\n3. third"],
    ["a task list", "- [ ] not done\n- [x] done"],
    ["a nested list", "- outer\n    - inner"],
    ["a blockquote", "> Someone said something."],
    ["fenced code", "```\nconst x = 1;\n```"],
    ["fenced code with a language", "```ts\nconst x: number = 1;\n```"],
    ["a horizontal rule", "Before.\n\n---\n\nAfter."],
    ["a whole post", POST],
  ];

  it.each(SUPPORTED)("publishes %s unchanged after a round trip", (_n, md) =>
    expectPublishesTheSame(md)
  );

  const ALTERNATE_SPELLINGS: Array<[string, string]> = [
    ["star bullets", "* a\n* b"],
    ["plus bullets", "+ a\n+ b"],
    ["underscore emphasis", "An _emphatic_ claim."],
    ["underscore strong", "A __bold__ claim."],
    ["asterisk rule", "Before.\n\n***\n\nAfter."],
    ["a closed ATX heading", "# Heading #"],
    ["parenthesised list numbering", "1) first\n2) second"],
  ];

  it.each(ALTERNATE_SPELLINGS)(
    "rewrites %s without changing the page",
    (_n, md) => expectPublishesTheSame(md)
  );
});

describe("what the editor has no transformer for", () => {
  // Lexical keeps a line it cannot parse as literal text and writes it back
  // untouched, so these survive a round trip even though the editor shows them
  // as raw Markdown rather than as a rendered table or image. That is the
  // property worth pinning: the editor may fail to *display* a construct, but
  // it must never destroy one.
  const PASSED_THROUGH: Array<[string, string]> = [
    ["a GFM table", "| a | b |\n| --- | --- |\n| 1 | 2 |"],
    ["a footnote", "Claim.[^1]\n\n[^1]: The evidence."],
    ["a reference link", "See [the docs][d].\n\n[d]: https://example.com"],
    ["a setext heading", "Section\n=======\n\nBody."],
    ["an indented code block", "Text.\n\n    const x = 1;"],
    ["an image", "![a diagram](https://example.com/diagram.png)"],
    ["raw HTML", '<div class="callout">Careful.</div>'],
  ];

  it.each(PASSED_THROUGH)("passes %s through untouched", (_n, md) => {
    expect(roundTrip(md)).toBe(md);
  });

  it("preserves a table sitting inside a post it can parse", async () => {
    const md = `${POST}\n\n| metric | before | after |\n| --- | --- | --- |\n| calls | 0 | 10 |`;
    expect(roundTrip(md)).toContain("| calls | 0 | 10 |");
    await expectPublishesTheSame(md);
  });
});

describe("what the editor produces is what the site publishes", () => {
  it("emits only Markdown that survives the sanitiser", async () => {
    const html = await renderPostHtml(roundTrip(POST));

    // Every block the editor can make has to reach the page. Anything the
    // sanitiser drops would look right while writing and vanish once live.
    expect(html).toContain("<h2>");
    expect(html).toContain("<h3>");
    expect(html).toContain("<strong>");
    expect(html).toContain("<ul>");
    expect(html).toContain("<li>");
    expect(html).toContain("<blockquote>");
    expect(html).toContain("<hr>");
    expect(html).toContain("<pre>");
    expect(html).toContain('class="language-ts"');
    expect(html).toContain('href="https://example.com/plan"');
    expect(html).not.toContain("<script");
  });

  it("keeps task lists renderable as checkboxes", async () => {
    const html = await renderPostHtml(roundTrip("- [ ] todo\n- [x] done"));
    expect(html).toContain('type="checkbox"');
    expect(html).toContain("checked");
  });

  it("never turns text into a highlight the sanitiser would drop", () => {
    // `==text==` is in Lexical's default transformer set and makes a `<mark>`,
    // which POST_SANITIZE_SCHEMA does not allow. Excluding HIGHLIGHT is why
    // POST_TRANSFORMERS is spelled out rather than imported wholesale.
    //
    // The assertion has to be about the editor's state, not its Markdown: with
    // HIGHLIGHT registered the round trip is still `==highlighted==` in and
    // `==highlighted==` out, so a string comparison passes either way. The
    // difference is only visible in between — the author sees the text
    // highlighted while writing and gets neither the marker nor the styling on
    // the published page.
    expect(formatsIn("A ==highlighted== claim.")).not.toContain("highlight");
    // The formats that are allowed still work, so this is not passing by
    // failing to parse anything at all.
    expect(formatsIn("A **bold** claim.")).toContain("bold");
  });
});
