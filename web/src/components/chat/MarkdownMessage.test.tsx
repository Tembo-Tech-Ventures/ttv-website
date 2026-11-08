import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { linkClass } from "@/components/platform/ui";
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

  it("draws links with the kit's link recipe and code in the platform's inks", () => {
    const html = renderToStaticMarkup(
      <MarkdownMessage content={"## Plan\n\nSee [the video](/dashboard/sessions/r1) and `npm test`.\n\n```\nnpm test\n```"} />
    );
    const link = /<a href="\/dashboard\/sessions\/r1" class="([^"]*)"/.exec(html)?.[1] ?? "";
    expect(link).toBe(linkClass());
    expect(html).not.toMatch(/text-primary|text-white|border-white|bg-dark/);
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
