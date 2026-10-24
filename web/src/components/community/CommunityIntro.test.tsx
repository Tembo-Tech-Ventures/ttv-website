import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import CommunityIntro, { CommunityJourneyCard } from "./CommunityIntro";
import { communityEntryHref } from "../../lib/community-entry";
import { validateNextPath } from "../../lib/auth/next-path";

describe("community entry points", () => {
  it.each([false, true])("preserves the supported sign-in destination for institutional=%s", institution => {
    const link = new URL(communityEntryHref(false, institution), "https://tembo.invalid");
    expect(link.pathname).toBe("/auth/login");
    expect(validateNextPath(link.searchParams.get("next"))).toBe(institution ? "/dashboard/discover" : "/dashboard/community");
    expect(communityEntryHref(true, institution)).toBe(link.searchParams.get("next"));
  });
  it("explains noncohort membership and approval without exposing a people directory", () => {
    const html = renderToStaticMarkup(<CommunityIntro full />);
    expect(html).toContain("You do not need to join or complete a cohort");
    expect(html).toContain("Signing in does not grant institutional access");
    expect(html).toContain("Cohort recordings and internal records are not part");
    expect(html).toContain("does not guarantee a job");
    expect(html.match(/<h1/g)).toHaveLength(1);
    expect(html).not.toContain("/api/community/profiles");
  });
  it("offers a direct journey link for signed-in members and a discoverable explainer", () => {
    const html = renderToStaticMarkup(<CommunityIntro isAuthenticated />);
    expect(html).toContain('href="/dashboard/community"');
    expect(html).toContain('href="/community"');
    expect(html).not.toContain("/auth/login");
    expect(html).not.toContain("<h1");
  });
  it("links the dashboard to the actual profile and contribution workspace", () => {
    const html = renderToStaticMarkup(<CommunityJourneyCard />);
    expect(html).toContain('href="/dashboard/community"');
    expect(html).toContain("Open my profile and journey");
  });
});
