import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import CommunityAudiencePage from "./CommunityAudiencePage";

describe("member audience page", () => {
  it("provides an honest join destination and clearly illustrative evidence without exposing a real profile", () => {
    const html = renderToStaticMarkup(<CommunityAudiencePage />);
    expect(html).toContain('href="/auth/login?next=%2Fdashboard%2Fcommunity"');
    expect(html).toMatch(/class="audience-cta-note">[^<]*Everyone signed in to TTV can see your profile and everything you post\. If you complete a cohort and publish, it’s also on the public website\./);
    expect(html).toContain("Fictional illustration");
    expect(html).toContain("Project source · example only");
    expect(html).toContain("not the whole person");
    // Every privacy sentence on the page says exactly what discovery covers.
    expect(html.match(/Everyone signed in to TTV can see your profile and everything you post/g)).toHaveLength(4);
    expect(html).not.toContain("available to approved institutions");
    expect(html).toContain("Cohort recordings and internal records are never part of a profile.");
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
    expect(html).toContain("Everyone signed in to TTV can see it, so keep private information out");
    expect(html).toContain("Listing your profile on the public website comes with completing a cohort.");
    expect(html).toContain('href="#your-first-contribution"');
    expect(html).toContain('id="your-first-contribution"');
  });
});
