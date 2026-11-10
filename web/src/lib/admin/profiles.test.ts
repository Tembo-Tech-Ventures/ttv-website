import { describe, expect, it } from "vitest";
import * as schema from "@/lib/db/schema";
import { parseProfileStatus, profileActionLabel, profileActionsFor, profileReviewReasons, PROFILE_DONE } from "./profiles";

describe("the admin's profile list", () => {
  it("reads a status filter only when it is one a profile can have", () => {
    for (const status of schema.studentProfile.status.enumValues) expect(parseProfileStatus(status)).toBe(status);
    expect(parseProfileStatus(null)).toBeNull();
    expect(parseProfileStatus("draft")).toBeNull();
    expect(parseProfileStatus("DELETED")).toBeNull();
  });

  it("offers only the actions that would change the profile", () => {
    expect(profileActionsFor({ status: "PUBLISHED", moderationReviewRequired: false })).toEqual(["unpublish"]);
    expect(profileActionsFor({ status: "PUBLISHED", moderationReviewRequired: true })).toEqual(["unpublish", "clear_flag"]);
    // Listing is the member's own choice: an admin never publishes a draft, only restores a paused profile.
    expect(profileActionsFor({ status: "DRAFT", moderationReviewRequired: true })).toEqual(["unpublish", "clear_flag"]);
    expect(profileActionsFor({ status: "SUSPENDED", moderationReviewRequired: true })).toEqual(["publish", "clear_flag"]);
  });

  it("says each action in words, a suspended profile being republished", () => {
    expect(profileActionLabel("publish", "PUBLISHED")).toBe("Republish");
    expect(profileActionLabel("publish", "DRAFT")).toBe("Restore");
    expect(profileActionLabel("unpublish")).toBe("Unpublish");
    expect(profileActionLabel("clear_flag")).toBe("Clear flag");
    expect(Object.values(PROFILE_DONE)).toEqual(["Profile restored", "Profile unpublished", "Flag cleared"]);
  });

  it("explains why a profile waits for a person in the check's own words", () => {
    expect(profileReviewReasons({ moderationFlags: '["contains_contact_details"]', moderationOutcome: "hold" })[0]).toMatch(/phone numbers, email addresses/);
    expect(profileReviewReasons({ moderationFlags: null, moderationOutcome: "error" })).toEqual([
      "The check was unavailable. This saved profile needs review.",
    ]);
    expect(profileReviewReasons({ moderationFlags: null, moderationOutcome: "pass" })).toEqual([]);
    expect(profileReviewReasons({ moderationFlags: null, moderationOutcome: null })).toEqual(["The content check has not finished. This saved profile needs review."]);
    expect(profileReviewReasons({ status: "PUBLISHED", moderationFlags: null, moderationOutcome: "error" })).toEqual(["The check was unavailable. This profile remains listed and needs review."]);
    expect(profileReviewReasons({ moderationFlags: null, moderationOutcome: "hold" })).toEqual(["The content check held this profile."]);
  });
});
