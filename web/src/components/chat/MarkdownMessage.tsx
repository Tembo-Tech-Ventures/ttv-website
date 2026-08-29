import React from "react";

interface InlineToken {
  type: "text" | "code" | "strong" | "em" | "link";
  text: string;
  href?: string;
}

interface Block {
  type: "paragraph" | "list" | "code" | "heading";
  text?: string;
  items?: string[];
  level?: 2 | 3;
}

function parseInline(text: string): InlineToken[] {
  const tokens: InlineToken[] = [];
  const pattern = /(`[^`]+`|\*\*[^*]+\*\*|\*[^*]+\*|\[[^\]]+\]\(([^)\s]+)\))/g;
  let cursor = 0;
  for (const match of text.matchAll(pattern)) {
    if (match.index === undefined) continue;
    if (match.index > cursor) {
      tokens.push({ type: "text", text: text.slice(cursor, match.index) });
    }
    const raw = match[0];
    if (raw.startsWith("`")) {
      tokens.push({ type: "code", text: raw.slice(1, -1) });
    } else if (raw.startsWith("**")) {
      tokens.push({ type: "strong", text: raw.slice(2, -2) });
    } else if (raw.startsWith("*")) {
      tokens.push({ type: "em", text: raw.slice(1, -1) });
    } else {
      const labelEnd = raw.indexOf("]");
      tokens.push({
        type: "link",
        text: raw.slice(1, labelEnd),
        href: raw.slice(labelEnd + 2, -1),
      });
    }
    cursor = match.index + raw.length;
  }
  if (cursor < text.length) tokens.push({ type: "text", text: text.slice(cursor) });
  return tokens;
}

function parseMarkdown(markdown: string): Block[] {
  const blocks: Block[] = [];
  const lines = markdown.replace(/\r\n/g, "\n").split("\n");
  let paragraph: string[] = [];
  let list: string[] = [];
  let code: string[] | null = null;

  function flushParagraph() {
    if (paragraph.length === 0) return;
    blocks.push({ type: "paragraph", text: paragraph.join(" ") });
    paragraph = [];
  }

  function flushList() {
    if (list.length === 0) return;
    blocks.push({ type: "list", items: list });
    list = [];
  }

  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed.startsWith("```")) {
      if (code) {
        blocks.push({ type: "code", text: code.join("\n") });
        code = null;
      } else {
        flushParagraph();
        flushList();
        code = [];
      }
      continue;
    }
    if (code) {
      code.push(line);
      continue;
    }
    if (!trimmed) {
      flushParagraph();
      flushList();
      continue;
    }
    if (trimmed.startsWith("### ")) {
      flushParagraph();
      flushList();
      blocks.push({ type: "heading", level: 3, text: trimmed.slice(4) });
      continue;
    }
    if (trimmed.startsWith("## ")) {
      flushParagraph();
      flushList();
      blocks.push({ type: "heading", level: 2, text: trimmed.slice(3) });
      continue;
    }
    const listMatch = trimmed.match(/^[-*]\s+(.+)$/);
    if (listMatch) {
      flushParagraph();
      list.push(listMatch[1]);
      continue;
    }
    flushList();
    paragraph.push(trimmed);
  }

  flushParagraph();
  flushList();
  if (code) blocks.push({ type: "code", text: code.join("\n") });
  return blocks;
}

function InlineContent({ text }: { text: string }) {
  return (
    <>
      {parseInline(text).map((token) => {
        const key = `${token.type}:${token.text}:${token.href ?? ""}`;
        if (token.type === "code") {
          return (
            <code key={key} className="rounded bg-dark/50 px-1 py-0.5 text-primary">
              {token.text}
            </code>
          );
        }
        if (token.type === "strong") return <strong key={key}>{token.text}</strong>;
        if (token.type === "em") return <em key={key}>{token.text}</em>;
        if (token.type === "link" && token.href) {
          const isSafeHref = token.href.startsWith("/") || token.href.startsWith("https://");
          return (
            <a
              key={key}
              href={isSafeHref ? token.href : "#"}
              className="font-semibold text-primary underline decoration-primary/40 underline-offset-2 hover:decoration-primary"
            >
              {token.text}
            </a>
          );
        }
        return <React.Fragment key={key}>{token.text}</React.Fragment>;
      })}
    </>
  );
}

export default function MarkdownMessage({ content }: { content: string }) {
  const blocks = parseMarkdown(content);
  if (blocks.length === 0) return null;

  return (
    <div className="space-y-3 whitespace-normal">
      {blocks.map((block) => {
        const key = `${block.type}:${block.level ?? ""}:${block.text ?? ""}:${(block.items ?? []).join("|")}`;
        if (block.type === "code") {
          return (
            <pre
              key={key}
              className="overflow-x-auto rounded-lg border border-white/10 bg-dark/70 p-3 text-xs text-white/85"
            >
              <code>{block.text}</code>
            </pre>
          );
        }
        if (block.type === "heading") {
          const className =
            block.level === 2
              ? "text-base font-semibold text-white"
              : "text-sm font-semibold text-white/90";
          return (
            <p key={key} className={className}>
              <InlineContent text={block.text ?? ""} />
            </p>
          );
        }
        if (block.type === "list") {
          return (
            <ul key={key} className="ml-4 list-disc space-y-1">
              {(block.items ?? []).map((item) => (
                <li key={item}>
                  <InlineContent text={item} />
                </li>
              ))}
            </ul>
          );
        }
        return (
          <p key={key}>
            <InlineContent text={block.text ?? ""} />
          </p>
        );
      })}
    </div>
  );
}
