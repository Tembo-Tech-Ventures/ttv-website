import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import ProfileEditor, {
  parseProfileSkills,
  profileSaveError,
  validateCommunityProfile,
  type EditableCommunityProfile,
} from "./ProfileEditor";

import { UiApiError } from "../discovery/ui-errors";

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
    expect(html).toContain('maxLength="2000"');
    expect(html).toContain("aria-labelledby=");
    expect(html).toContain("Saving updates the community profile that approved institutions can");
    expect(html).toContain("-visibility");
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
        skills: Array.from({ length: 30 }, () => "a".repeat(60)),
        opportunityGoals: "a".repeat(2000),
      }),
    ).toBeNull();
  });
  it.each([
    [{ headline: "a".repeat(161) }, "160"],
    [{ bio: "a".repeat(4001) }, "4,000"],
    [{ skills: Array.from({ length: 31 }, () => "TypeScript") }, "30 skills"],
    [{ skills: ["a".repeat(61)] }, "60 characters"],
    [{ opportunityGoals: "a".repeat(2001) }, "2,000"],
  ])("rejects an oversized profile field", (fields, message) => {
    expect(validateCommunityProfile({ ...initial, ...fields })).toContain(
      message,
    );
  });
});

describe("profile save error boundary", () => {
  it.each([
    [401, "Your session has ended. Sign in again to continue."],
    [403, "Your account does not have access to this action."],
    [429, "Too many requests. Please wait a moment and try again."],
    [503, "This service is unavailable right now. Please try again later."],
  ])("preserves the safe message for status %s", (status, message) => {
    expect(profileSaveError(new UiApiError(status))).toBe(message);
  });
  it.each([
    new Error("private backend details"),
    { status: 401, message: "private backend details" },
    "private backend details",
    null,
  ])("hides unknown error details and explains draft recovery", (failure) => {
    expect(profileSaveError(failure)).toBe(
      "Your profile could not be saved. Your draft is still here; please try again.",
    );
  });
});
