import { unified } from "unified";
import remarkParse from "remark-parse";
import remarkGfm from "remark-gfm";
import remarkRehype from "remark-rehype";
import rehypeSanitize from "rehype-sanitize";
import type { Schema } from "hast-util-sanitize";
import rehypeStringify from "rehype-stringify";
import type { Root, Element, Nodes } from "hast";

export const POST_RENDER_VERSION = 1;

declare const __rendered: unique symbol;
export type RenderedHtml = string & { readonly [__rendered]: true };

const SITE_HOSTS = new Set([
  "tembotechventures.com",
  "www.tembotechventures.com",
]);

export const POST_SANITIZE_SCHEMA: Schema = {
  strip: ["script", "style"],
  clobberPrefix: "user-content-",
  clobber: ["name", "id"],
  ancestors: {},
  tagNames: [
    "a",
    "blockquote",
    "br",
    "code",
    "del",
    "em",
    "h2",
    "h3",
    "h4",
    "h5",
    "h6",
    "hr",
    "input",
    "li",
    "ol",
    "p",
    "pre",
    "s",
    "strong",
    "sub",
    "sup",
    "table",
    "tbody",
    "td",
    "th",
    "thead",
    "tr",
    "ul",
  ],
  attributes: {
    a: ["href", "rel", "target"],
    code: [["className", /^language-./]],
    input: [["type", "checkbox"], "checked", "disabled"],
    td: ["align"],
    th: ["align"],
    "*": [] as string[],
  },
  protocols: {
    href: ["http", "https", "mailto"],
  },
  required: {
    input: { type: "checkbox", disabled: true },
  },
  allowComments: false,
  allowDoctypes: false,
};

function walk(node: Nodes, fn: (node: Nodes) => void) {
  fn(node);
  if ("children" in node) {
    for (const child of node.children) {
      walk(child, fn);
    }
  }
}

function rehypeShiftHeadings() {
  return (tree: Root) => {
    walk(tree, (node) => {
      if (node.type !== "element") return;
      const el = node as Element;
      const match = /^h([1-6])$/.exec(el.tagName);
      if (match) {
        el.tagName = `h${Math.min(Number(match[1]) + 1, 6)}`;
      }
    });
  };
}

function rehypeExternalLinks() {
  return (tree: Root) => {
    walk(tree, (node) => {
      if (node.type !== "element") return;
      const el = node as Element;
      if (el.tagName !== "a" || typeof el.properties?.href !== "string") return;
      try {
        const url = new URL(el.properties.href);
        if (
          (url.protocol === "http:" || url.protocol === "https:") &&
          !SITE_HOSTS.has(url.hostname)
        ) {
          el.properties.rel = ["nofollow", "ugc", "noopener", "noreferrer"];
          el.properties.target = "_blank";
        }
      } catch {
        // relative or malformed — leave as-is
      }
    });
  };
}

export async function renderPostHtml(markdown: string): Promise<RenderedHtml> {
  const result = await unified()
    .use(remarkParse)
    .use(remarkGfm)
    .use(remarkRehype, { allowDangerousHtml: false })
    .use(rehypeShiftHeadings)
    .use(rehypeExternalLinks)
    .use(rehypeSanitize, POST_SANITIZE_SCHEMA)
    .use(rehypeStringify)
    .process(markdown);

  return String(result) as RenderedHtml;
}
