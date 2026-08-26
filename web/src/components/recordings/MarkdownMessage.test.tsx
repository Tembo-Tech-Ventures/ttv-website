import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import MarkdownMessage from "./MarkdownMessage";

describe("MarkdownMessage", () => {
  it("renders common chatbot markdown safely", () => {
    const html = renderToStaticMarkup(
      <MarkdownMessage
        content={[
          "## Plan",
          "",
          "Use **customer discovery** before `building`.",
          "",
          "- Interview users",
          "- Open [the cited video](/dashboard/sessions/r1?t=42)",
          "",
          "```",
          "npm test",
          "```",
        ].join("\n")}
      />
    );

    expect(html).toContain("<strong>customer discovery</strong>");
    expect(html).toContain(">building</code>");
    expect(html).toContain("<ul");
    expect(html).toContain('href="/dashboard/sessions/r1?t=42"');
    expect(html).toContain("npm test");
  });

  it("does not render unsafe links as navigable targets", () => {
    const unsafeHref = "mailto:test@example.com";
    const html = renderToStaticMarkup(
      <MarkdownMessage content={`[bad](${unsafeHref})`} />
    );

    expect(html).toContain('href="#"');
    expect(html).not.toContain("mailto:test");
  });
});
