import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import ProfileEditor, {
  parseProfileSkills,
  validateCommunityProfile,
  type EditableCommunityProfile,
} from "./ProfileEditor";

const initial: EditableCommunityProfile = {
  headline: "Community builder",
  bio: "I build accessible tools.",
  skills: ["TypeScript", "Accessibility"],
  opportunityGoals: "Find a student developer role.",
};

describe("ProfileEditor", () => {
  it("renders labelled fields containing the existing profile without claiming a save", () => {
    const save = vi.fn(async () => {});
    const html = renderToStaticMarkup(
      <ProfileEditor initial={initial} onSave={save} />,
    );
    for (const label of [
      "Headline",
      "About your work",
      "Skills (comma-separated)",
      "Opportunity goals",
    ]) {
      expect(html).toContain(label);
    }
    expect(html).toContain('value="Community builder"');
    expect(html).toContain("I build accessible tools.");
    expect(html).toContain('value="TypeScript, Accessibility"');
    expect(html).toContain(initial.opportunityGoals);
    expect(html).toContain('maxLength="160"');
    expect(html).toContain('maxLength="4000"');
    expect(html).toContain('maxLength="1000"');
    expect(html).toContain("aria-labelledby=");
    expect(html).not.toContain("Profile saved.");
    expect(save).not.toHaveBeenCalled();
  });
  it("labels demonstration edits explicitly", () => {
    const html = renderToStaticMarkup(
      <ProfileEditor initial={initial} onSave={vi.fn(async () => {})} demo />,
    );
    expect(html).toContain("not updates to a real member profile");
    expect(html).toContain("Save demo profile");
  });
});

describe("profile draft validation", () => {
  it("parses comma-separated skills without empty entries", () => {
    expect(parseProfileSkills(" TypeScript, , Accessibility ,")).toEqual([
      "TypeScript",
      "Accessibility",
    ]);
    expect(parseProfileSkills(" , ")).toEqual([]);
  });
  it("accepts an ordinary profile and allows an incomplete draft", () => {
    expect(validateCommunityProfile(initial)).toBeNull();
    expect(
      validateCommunityProfile({
        headline: "",
        bio: "",
        skills: [],
        opportunityGoals: "",
      }),
    ).toBeNull();
  });
  it("accepts exact limits", () => {
    expect(
      validateCommunityProfile({
        headline: "a".repeat(160),
        bio: "a".repeat(4000),
        skills: Array.from({ length: 20 }, () => "a".repeat(60)),
        opportunityGoals: "a".repeat(1000),
      }),
    ).toBeNull();
  });
  it.each([
    [{ headline: "a".repeat(161) }, "160"],
    [{ bio: "a".repeat(4001) }, "4,000"],
    [{ skills: Array.from({ length: 21 }, () => "TypeScript") }, "20 skills"],
    [{ skills: ["a".repeat(61)] }, "60 characters"],
    [{ opportunityGoals: "a".repeat(1001) }, "1,000"],
  ])("rejects an oversized profile field", (fields, message) => {
    expect(validateCommunityProfile({ ...initial, ...fields })).toContain(
      message,
    );
  });
});
