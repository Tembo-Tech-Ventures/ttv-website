import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import CommunityLanding from "./CommunityLanding";

 describe("community landing", () => {
  it.each([false, true])("offers all three persona routes and correct entry paths (authenticated=%s)", isAuthenticated => {
    const html = renderToStaticMarkup(<CommunityLanding isAuthenticated={isAuthenticated} />);
    expect(html.match(/<h1 /g)).toHaveLength(1);
    expect(html).toContain("Approved institutions can discover your saved community profile and the contributions you share.");
    expect(html).toContain("Approved institutions can discover saved community profiles and the contributions members share.");
    expect(html).not.toContain("can explore documented work");
    for (const persona of ["members", "mentors", "institutions"]) expect(html).toContain(`href="/community/${persona}"`);
    for (const destination of ["/dashboard/community", "/dashboard/discover"]) {
      expect(html).toContain(`href="${isAuthenticated ? destination : `/auth/login?next=${encodeURIComponent(destination)}`}"`);
    }
    expect(html).toContain('aria-label="Community participation"');
    expect(html).toContain('id="institutions"');
    expect(html).toContain("You do not need to join or complete a cohort");
    expect(html).toContain("Institutional access requires administrator approval after sign-in");
    expect(html).toContain("Cohort recordings and internal records are not part");
    expect(html).toContain("does not guarantee a job");
    expect(html.includes("Continue with GitHub")).toBe(!isAuthenticated);
    expect(html).not.toContain("/api/community");
  });
});
