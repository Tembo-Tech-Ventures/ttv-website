import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { validateNextPath } from "../../lib/auth/next-path";
import CommunityPartnerPage from "./CommunityPartnerPage";

describe("community partner audience pages", () => {
  it.each([
    ["mentors", "/dashboard/mentorship", "Mentor"],
    ["institutions", "/dashboard/discover", "Institutional"],
  ] as const)("retains the %s destination across sign-in and explains the approval gate", (audience, destination, role) => {
    const html = renderToStaticMarkup(<CommunityPartnerPage audience={audience} />);
    expect(html).toContain(`href="/auth/login?next=${encodeURIComponent(destination)}"`);
    expect(validateNextPath(destination)).toBe(destination);
    expect(html).toContain(`${role} access requires administrator approval after sign-in.`);
    expect(html).toContain("Fictional illustration");
    expect(html).toContain("<details><summary>");
    expect(html).not.toContain("/api/community");
    expect(html).not.toContain("<button");
    expect(html.match(/<h1 /g)).toHaveLength(1);
    const signedIn = renderToStaticMarkup(<CommunityPartnerPage audience={audience} isAuthenticated />);
    expect(signedIn).toContain(`href="${destination}"`);
    expect(signedIn).not.toContain("/auth/login");
    expect(signedIn).not.toContain("Continue with GitHub");
    expect(signedIn).toContain("administrator approval");
  });
  it("ties mentor confirmation to the reviewed work, revision and method", () => {
    const html = renderToStaticMarkup(<CommunityPartnerPage audience="mentors" />);
    expect(html).toContain("What I checked");
    expect(html).toContain("How I checked:");
    expect(html).toContain("revision 1");
    expect(html).toContain("Not a certification of the whole person");
    expect(html).toContain("Signing in does not grant that access");
  });
  it("separates evidence from human judgment and respects private-data boundaries", () => {
    const html = renderToStaticMarkup(<CommunityPartnerPage audience="institutions" />);
    expect(html).toContain("Member claim:");
    expect(html).toContain("Mentor note:");
    expect(html).toContain("not an automated recommendation");
    expect(html).toContain("Missing evidence is not evidence of low ability");
    expect(html).toContain("Private cohort recordings and internal records stay outside");
    expect(html).toContain("does not send a message, book an interview, or arrange an introduction");
  });
});
