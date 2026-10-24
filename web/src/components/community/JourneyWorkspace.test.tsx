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
  skills: "React",
  sourceTitle: "",
  sourceUrl: "",
};
describe("community contribution editor", () => {
  it("makes institutional visibility explicit without making private calls discoverable", () => {
    const html = renderToStaticMarkup(
      <JourneyWorkspace profile={demoProfiles[0]} demo />,
    );
    expect(html).toContain("approved institutions");
    expect(html).toContain(
      "Private calls, recordings, and internal information do not belong here",
    );
    expect(html).toContain("Checked by Jules Martin");
    expect(html).toContain("Member-reported");
  });
  it("supports a contribution before evidence or mentor confirmation exists", () => {
    expect(validateClaimDraft(draft)).toBeNull();
    const html = renderToStaticMarkup(
      <JourneyWorkspace profile={{ ...demoProfiles[0], claims: [] }} />,
    );
    expect(html).toContain("Your first contribution belongs here");
  });
  it.each([
    [{ title: "a" }, "title"],
    [{ description: "short" }, "contribution"],
    [{ date: "" }, "date"],
    // oxlint-disable-next-line no-script-url -- Negative test for rejected executable URLs.
    [{ sourceUrl: "javascript:alert(1)" }, "http or https"],
    [{ sourceUrl: "https://example.com" }, "title"],
  ] as const)("rejects incomplete/unsafe input %j", (change, expected) => {
    expect(validateClaimDraft({ ...draft, ...change })).toContain(expected);
  });
  it("accepts a titled web source", () => {
    expect(
      validateClaimDraft({
        ...draft,
        sourceTitle: "Code",
        sourceUrl: "https://example.com/code",
      }),
    ).toBeNull();
  });
});
