import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import JourneyWorkspace, {
  validateClaimDraft,
  type ClaimDraft,
} from "./JourneyWorkspace";
import { demoProfiles } from "../discovery/fixtures";

const draft: ClaimDraft = {
  title: "Library interface",
  description: "I implemented the library borrowing form and keyboard focus.",
  date: "2026-10-20",
  sourceUrl: "",
};
describe("community contribution editor", () => {
  it("makes institutional visibility explicit without making private calls discoverable", () => {
    const html = renderToStaticMarkup(
      <JourneyWorkspace profile={demoProfiles[0]} demo />,
    );
    expect(html).toContain("Approved institutions can discover your saved community profile and the contributions you share.");
    expect(html).toContain("Private contributions remain visible only to you");
    expect(html).toContain("Mentors can review those shared contributions");
    expect(html).not.toContain("Unpublished drafts are visible only to you");
    expect(html).toContain(
      "Private calls, recordings, and internal information do not belong here",
    );
    expect(html).toContain("Checked by Grace Njeri");
    expect(html).toContain("Member-reported");
    expect(html).toContain("Opportunity goals");
    expect(html).toContain("Show what you made, what you learned, and the part that was yours.");
    expect(html).not.toContain("Keep the story moving");
    expect(html).not.toContain("Your next chapter");
  });
  it("supports a contribution before evidence or mentor confirmation exists", () => {
    expect(validateClaimDraft(draft)).toBeNull();
    const html = renderToStaticMarkup(
      <JourneyWorkspace profile={{ ...demoProfiles[0], claims: [] }} />,
    );
    expect(html).toContain("Your first contribution belongs here");
  });
  it("frames the journey as onboarding says, member framing by default", () => {
    const empty = { ...demoProfiles[0], claims: [] };
    const member = renderToStaticMarkup(<JourneyWorkspace profile={empty} framing="member" />);
    expect(member).toBe(renderToStaticMarkup(<JourneyWorkspace profile={empty} />));
    // Just looking around: the welcome card above replaces the first contribution prompt.
    const exploring = renderToStaticMarkup(<JourneyWorkspace profile={empty} framing="exploring" />);
    expect(exploring).not.toContain("Your first contribution belongs here");
    expect(exploring).toContain("<h2>Your journey</h2>");
    // Mentors and organisations: their own work, fully usable, without a student's prompt.
    const partner = renderToStaticMarkup(<JourneyWorkspace profile={empty} framing="partner" />);
    expect(partner).not.toContain("Your first contribution belongs here");
    expect(partner).toContain("<h2>Your own work</h2>");
    expect(partner).toContain("Add a contribution");
  });
  it.each([
    [{ title: "a" }, "title"],
    [{ description: "short" }, "contribution"],
    [{ date: "" }, "date"],
    // oxlint-disable-next-line no-script-url -- Negative test for rejected executable URLs.
    [{ sourceUrl: "javascript:alert(1)" }, "HTTPS"],
    [{ sourceUrl: "http://example.com" }, "HTTPS"],
    [{ date: "2026-02-30" }, "date"],
    [{ sourceUrl: "https://example.com/dashboard/secret" }, "private"],
  ] as const)("rejects incomplete/unsafe input %j", (change, expected) => {
    expect(validateClaimDraft({ ...draft, ...change })).toContain(expected);
  });
  it("accepts a titled web source", () => {
    expect(
      validateClaimDraft({
        ...draft,
        sourceUrl: "https://example.com/code",
      }),
    ).toBeNull();
  });
});

it('offers editing only through the own-journey update callback or explicit demo',()=>{
 const profile=demoProfiles[0];expect(renderToStaticMarkup(<JourneyWorkspace profile={profile} onUpdate={async claim=>claim}/>)).toContain('Edit '+profile.claims[0].title);
 expect(renderToStaticMarkup(<JourneyWorkspace profile={profile}/>)).not.toContain('Edit '+profile.claims[0].title);
});
