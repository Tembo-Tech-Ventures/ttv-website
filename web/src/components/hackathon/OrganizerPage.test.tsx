import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { readFileSync } from "node:fs";
import { describe, it, expect } from "vitest";
import OrganizerPage, { sections } from "./OrganizerPage";
const html = renderToStaticMarkup(<OrganizerPage />);
describe("read-only organizer overview", () => {
  it("has one heading and a target for every table-of-contents link", () => {
    expect(html.match(/<h1>/g)).toHaveLength(1);
    for (const [id] of sections) {
      expect(html).toContain(`href="#${id}"`);
      expect(html).toContain(`id="${id}"`);
    }
  });
  it("keeps public overview separate from interactive or sensitive routes", () => {
    expect(html).not.toMatch(
      /<form|<iframe|<script|href="\/(?:api|auth|admin|demo|dashboard)|sam-mcp|01M5|Bearer/,
    );
    const route = readFileSync(
      new URL("../../pages/openai-hackathon.astro", import.meta.url),
      "utf8",
    );
    expect(route).toContain("export const prerender = true");
    expect(route).not.toMatch(
      /Astro.locals|cloudflare:workers|client:|fetch\(/,
    );
  });
  it("ships static diagrams with accessible descriptions and no executable/external resources", () => {
    for (const name of ["journeys", "architecture"]) {
      const svg = readFileSync(
        new URL(`../../../public/hackathon/${name}.svg`, import.meta.url),
        "utf8",
      );
      expect(svg).toContain("<title");
      expect(svg).toContain("<desc");
      expect(svg).not.toMatch(
        /<script|<foreignObject|onload=|(?:href|src)="https?:/,
      );
    }
  });
});
