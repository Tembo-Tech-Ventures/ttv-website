import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import ClaimConfirmations from "./ClaimConfirmations";
import { currentConfirmations } from "./types";
import { demoProfiles } from "./fixtures";
import JourneyWorkspace from "../community/JourneyWorkspace";

describe("revision-specific evidence", () => {
  it("retains historical notes without counting them as current confirmations", () => {
    const claim = { ...demoProfiles[0].claims[0], version: 2 };
    expect(currentConfirmations(claim)).toEqual([]);
    const html = renderToStaticMarkup(<ClaimConfirmations claim={claim} />);
    expect(html).toContain("Previous revision checked by");
    expect(html).toContain("Review needed for current revision 2");
    expect(html).not.toContain("Claim-specific confirmation");
  });
  it.each(["ADMIN", "UNKNOWN"] as const)(
    "preserves the recorded %s role instead of inventing mentor attribution",
    (role) => {
      const original = demoProfiles[0].claims[0];
      const claim = {
        ...original,
        confirmations: [{ ...original.confirmations[0], mentorRole: role }],
      };
      const html = renderToStaticMarkup(<ClaimConfirmations claim={claim} />);
      expect(html).toContain(
        role === "ADMIN" ? "Administrator" : "Not recorded",
      );
      expect(html).not.toContain("Role when recorded: Mentor");
    },
  );
  it("labels unpublished draft entries distinctly from published contributions", () => {
    const profile = {
      ...demoProfiles[0],
      claims: [
        { ...demoProfiles[0].claims[0], visibility: "private" as const },
      ],
    };
    expect(
      renderToStaticMarkup(<JourneyWorkspace profile={profile} />),
    ).toContain("Unpublished draft · Only you can see this contribution.");
  });
});
