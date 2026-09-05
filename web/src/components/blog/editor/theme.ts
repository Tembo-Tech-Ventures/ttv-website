/**
 * How the editor renders each node.
 *
 * These class names are the whole visual argument of the writing surface, so
 * they are tuned to read as an article rather than as a form field: one wide
 * measure, generous leading, and the same display face the published post uses
 * for its headings. What the author sees while typing should be within a
 * hair of `/blog/<handle>/<slug>`.
 */
import type { EditorThemeClasses } from "lexical";

export const POST_EDITOR_THEME: EditorThemeClasses = {
  paragraph: "post-body my-5 first:mt-0",
  heading: {
    // `#` in Markdown, `<h2>` once published — `renderPostHtml` shifts every
    // heading down one so the post title keeps the page's only `<h1>`.
    h1: "font-heading text-[1.75rem] leading-tight tracking-heading text-ink-primary mt-10 mb-3 first:mt-0",
    h2: "font-heading text-[1.4rem] leading-snug tracking-subhead text-ink-primary mt-8 mb-2 first:mt-0",
    h3: "text-lg font-bold leading-snug text-ink-primary mt-6 mb-2 first:mt-0",
    h4: "text-base font-bold text-ink-primary mt-6 mb-2 first:mt-0",
    h5: "text-sm font-bold uppercase tracking-wider text-ink-secondary mt-6 mb-2 first:mt-0",
    h6: "text-sm font-bold uppercase tracking-wider text-ink-muted mt-6 mb-2 first:mt-0",
  },
  quote:
    "post-body my-6 border-l-2 border-primary/60 pl-5 italic text-ink-secondary",
  list: {
    ul: "post-body my-5 list-disc pl-6 marker:text-primary/70",
    ol: "post-body my-5 list-decimal pl-6 marker:text-primary/70",
    listitem: "my-1.5 pl-1",
    // A list nested inside a list already has the parent's margin above it.
    nested: { listitem: "list-none" },
    listitemChecked:
      "post-checkbox my-1.5 pl-1 line-through text-ink-muted",
    listitemUnchecked: "post-checkbox my-1.5 pl-1",
    olDepth: [
      "list-decimal",
      "list-[lower-alpha]",
      "list-[lower-roman]",
      "list-decimal",
      "list-[lower-alpha]",
    ],
  },
  code: "post-code-block",
  link: "text-primary underline decoration-primary/40 underline-offset-2 hover:decoration-primary",
  hr: "post-hr",
  text: {
    bold: "font-semibold text-ink-primary",
    italic: "italic",
    strikethrough: "line-through text-ink-muted",
    code: "rounded bg-dark/70 px-1.5 py-0.5 font-mono text-[0.9em] text-accent-bright",
    underline: "underline underline-offset-2",
    underlineStrikethrough: "underline line-through underline-offset-2",
  },
};
