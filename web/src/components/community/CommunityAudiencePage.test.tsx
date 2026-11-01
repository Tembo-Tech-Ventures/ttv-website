import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import CommunityAudiencePage from "./CommunityAudiencePage";

describe("member audience page", () => {
  it("provides an honest join destination and clearly illustrative evidence without exposing a real profile", () => {
    const html = renderToStaticMarkup(<CommunityAudiencePage />);
    expect(html).toContain('href="/auth/login?next=%2Fdashboard%2Fcommunity"');
    expect(html).toMatch(/class="audience-cta-note">[^<]*Approved institutions can discover your saved community profile and the contributions you share\./);
    expect(html).toContain("Fictional illustration");
    expect(html).toContain("Project source · example only");
    expect(html).toContain("not the whole person");
    // Every privacy sentence on the page says exactly what discovery covers.
    expect(html.match(/Approved institutions can discover your saved community profile and the contributions you share\./g)).toHaveLength(4);
    expect(html).not.toContain("available to approved institutions");
    expect(html).toContain("Private cohort recordings and internal records stay outside");
    expect(html).toContain("does not guarantee a job");
    expect(html).not.toContain("/api/community");
    expect(html).not.toContain("<button");
    expect(html.match(/<h1 /g)).toHaveLength(1);
  });
  it("lets signed-in members proceed directly and retains native disclosure content in server HTML", () => {
    const html = renderToStaticMarkup(<CommunityAudiencePage isAuthenticated />);
    expect(html).toContain('href="/dashboard/community"');
    expect(html).not.toContain("/auth/login");
    expect(html).not.toContain("Continue with GitHub");
    expect(html).toContain("<summary>What can I share?</summary>");
    expect(html).toContain("Keep private information out");
    expect(html).toContain('href="#your-first-contribution"');
    expect(html).toContain('id="your-first-contribution"');
  });
});
