import { describe, expect, it } from "vitest";

import type { PublicLink } from "./site";
import {
  formatCohortLocation,
  PUBLIC_FOOTER_GROUPS,
  PUBLIC_NAV_LINKS,
  SITE_FACTS,
} from "./site";

describe("public navigation", () => {
  it("keeps the public front-door links in the intended order", () => {
    expect(PUBLIC_NAV_LINKS).toEqual([
      { label: "How", href: "/#cohorts" },
      { label: "Why", href: "/#principles" },
      { label: "Community", href: "/community" },
      { label: "Builders", href: "/talent" },
      { label: "Hire", href: "/hire" },
      { label: "Blog", href: "/blog" },
    ]);
  });

  it("mirrors every public navigation and account link in the footer", () => {
    const footerLinks: PublicLink[] = [];
    for (const group of PUBLIC_FOOTER_GROUPS) {
      footerLinks.push(...group.links);
    }
    const expectedLinks = [
      ...PUBLIC_NAV_LINKS,
      { label: "Sign in", href: "/auth/login" },
      { label: "Apply", href: "/dashboard/apply" },
    ];

    for (const link of expectedLinks) {
      expect(footerLinks).toContainEqual(link);
    }
  });

  it("links the public style guide from the footer only, beside the other things to read", () => {
    const read = PUBLIC_FOOTER_GROUPS.find((group) => group.heading === "Read");
    expect(read?.links).toContainEqual({ label: "Style guide", href: "/style-guide" });
    expect(PUBLIC_NAV_LINKS.map((link) => link.href)).not.toContain("/style-guide");
  });
});

describe("homepage facts", () => {
  it("keeps current cohort and scale copy in one configuration", () => {
    expect(SITE_FACTS).toMatchObject({
      currentCohort: "Cohort 04",
      currentCohortNumber: "04",
      approximateStudentCount: "~25",
      partnerSchoolCount: "01",
      partnerSchoolName: "Embu College",
    });
  });

  it("formats cohort and country without a dangling separator", () => {
    expect(formatCohortLocation("Cohort 04", "Kenya")).toBe(
      "Cohort 04 · Kenya"
    );
    expect(formatCohortLocation("Cohort 04", null)).toBe("Cohort 04");
    expect(formatCohortLocation(null, "Kenya")).toBe("Kenya");
    expect(formatCohortLocation(null, null)).toBe("");
  });
});
