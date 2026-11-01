import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { validateNextPath } from "../../lib/auth/next-path";
import { WELCOME_LEGACY_PATHS, parseWelcomeHint } from "../../lib/platform/server/onboarding-routing";
import { WELCOME_PATH } from "../../lib/platform/server/space-routes";
import CommunityPartnerPage, { partnerHref } from "./CommunityPartnerPage";

const literal = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

describe("community partner audience pages", () => {
  it.each([
    ["mentors", "/dashboard/welcome?intent=mentor", "Mentor"],
    ["institutions", "/dashboard/welcome?intent=institution", "Institutional"],
  ] as const)("sends the %s CTA through sign-in to the welcome step and explains the approval gate", (audience, destination, role) => {
    const html = renderToStaticMarkup(<CommunityPartnerPage audience={audience} />);
    expect(html.match(new RegExp(`href="${literal(`/auth/login?next=${encodeURIComponent(destination)}`)}"`, "g"))).toHaveLength(2);
    expect(validateNextPath(destination)).toBe(destination);
    expect(html).toContain(`${role} access requires administrator approval after sign-in.`);
    expect(html).toContain("Fictional illustration");
    expect(html).toContain("<details><summary>");
    expect(html).not.toContain("/api/community");
    expect(html).not.toContain("<button");
    expect(html.match(/<h1 /g)).toHaveLength(1);
    const signedIn = renderToStaticMarkup(<CommunityPartnerPage audience={audience} isAuthenticated />);
    expect(signedIn.match(new RegExp(`href="${literal(destination)}"`, "g"))).toHaveLength(2);
    expect(signedIn).not.toContain("/auth/login");
    expect(signedIn).not.toContain("Continue with GitHub");
    expect(signedIn).toContain("administrator approval");
  });

  // B-O.4 is what keeps these links working while onboarding is off: it reads the hint and sends it
  // on to the page each CTA opened before. Pin both halves of that contract here.
  it.each([
    ["mentors", "MENTOR", "/dashboard/mentorship"],
    ["institutions", "INSTITUTION", "/dashboard/discover"],
  ] as const)("hints %s to the welcome step, which falls back to the page this CTA used to open", (audience, intent, legacy) => {
    const next = new URL(partnerHref(audience, false), "https://tembo.invalid").searchParams.get("next");
    expect(next).toBe(partnerHref(audience, true));
    const landing = new URL(validateNextPath(next), "https://tembo.invalid");
    expect(landing.pathname).toBe(WELCOME_PATH);
    expect(parseWelcomeHint(landing.searchParams)).toBe(intent);
    expect(WELCOME_LEGACY_PATHS[intent]).toBe(legacy);
  });

  it.each([
    ["mentors", "Ask to mentor", "Continue to mentor review", "Can I start reviewing as soon as I sign in?"],
    ["institutions", "Ask for institutional access", "Continue to institutional access", "Who can use institutional discovery?"],
  ] as const)("tells the %s access story the flow after sign-in supports", (audience, requestCta, legacyCta, question) => {
    const legacy = renderToStaticMarkup(<CommunityPartnerPage audience={audience} />);
    const request = renderToStaticMarkup(<CommunityPartnerPage audience={audience} flow="request" />);
    expect(legacy).toContain('data-access-flow="legacy"');
    expect(request).toContain('data-access-flow="request"');
    expect(legacy.split(legacyCta)).toHaveLength(3);
    expect(request.split(requestCta)).toHaveLength(3);
    expect(request).not.toContain(legacyCta);
    // The CTA goes to the same place either way: only the words follow the flow.
    expect(request.match(/href="\/auth\/login[^"]*"/g)).toEqual(legacy.match(/href="\/auth\/login[^"]*"/g));

    const answer = (html: string) => html.split(`<summary>${question}</summary><p>`)[1]!.split("</p>")[0]!;
    // While onboarding is off, the legacy page explains the requirement: no request exists yet.
    expect(answer(legacy)).toContain("explains the requirement");
    expect(answer(legacy)).not.toMatch(/pending|request/i);
    // While it is on: an administrator decides, the request waits as pending, and nothing is promised.
    const text = answer(request);
    expect(text).toContain("Signing in");
    expect(text).toContain("An administrator reads each request and decides; approval is not guaranteed.");
    expect(text).toContain("pending");
    expect(text).toContain("like any member");
    expect(text).not.toMatch(/explains the requirement|denied|empower|uplift|give back|help them/i);
  });

  it("ties mentor confirmation to the reviewed work, revision and method", () => {
    const html = renderToStaticMarkup(<CommunityPartnerPage audience="mentors" />);
    expect(html).toContain("How much time should I set aside?");
    expect(html).toContain("agree its scope and timing with the team");
    expect(html).toContain("What I checked");
    expect(html).toContain("How I checked:");
    expect(html).toContain("revision 1");
    expect(html).toContain("Not a certification of the whole person");
    expect(html).toContain("Signing in does not grant that access");
  });
  it("separates evidence from human judgment and respects private-data boundaries", () => {
    const html = renderToStaticMarkup(<CommunityPartnerPage audience="institutions" />);
    expect(html).toContain("Approved institutions can discover saved community profiles and the contributions members share.");
    expect(html).toContain("Start with hiring. Explore the work behind a profile and decide what to ask next.");
    expect(html).not.toContain("single, generic role");
    expect(html).toContain("Member claim:");
    expect(html).toContain("Mentor note:");
    expect(html).toContain("not an automated recommendation");
    expect(html).toContain("Missing evidence is not evidence of low ability");
    expect(html).toContain("Private cohort recordings and internal records stay outside");
    expect(html).toContain("does not send a message, book an interview, or arrange an introduction");
  });
});
