import { describe, expect, it } from "vitest";
import { toHomepageBuilder, type BuilderProfileRow } from "./builders";

const completed = { status: "COMPLETED", completedAt: new Date("2025-02-01"), program: { name: "Cohort 02" } };

function profile(overrides: Partial<BuilderProfileRow> = {}): BuilderProfileRow {
  return {
    handle: "fixture-wanjiru",
    headline: "  Backend developer  ",
    country: "Kenya",
    skills: "TypeScript, PostgreSQL ,, Node.js, Go",
    publicName: "Wanjiru Kamau",
    publicAvatarUrl: null,
    highlights: [{ repoFullName: "fixture/chama-ledger", description: "Shared savings ledger.", language: "TypeScript" }],
    user: { programApplications: [completed] },
    ...overrides,
  };
}

describe("toHomepageBuilder", () => {
  it("maps a published graduate to a showcase card", () => {
    expect(toHomepageBuilder(profile())).toEqual({
      handle: "fixture-wanjiru",
      href: "/talent/fixture-wanjiru",
      name: "Wanjiru Kamau",
      image: null,
      initials: "WK",
      headline: "Backend developer",
      cohort: "Cohort 02",
      country: "Kenya",
      skills: ["TypeScript", "PostgreSQL", "Node.js"],
      project: { name: "chama-ledger", description: "Shared savings ledger.", language: "TypeScript" },
    });
  });

  it("excludes profiles without a valid cohort completion", () => {
    expect(toHomepageBuilder(profile({ user: { programApplications: [] } }))).toBeNull();
    expect(
      toHomepageBuilder(profile({ user: { programApplications: [{ ...completed, completedAt: null }] } })),
    ).toBeNull();
  });

  it("uses only the checked public identity snapshot", () => {
    const card = toHomepageBuilder(profile({ publicName: null, publicAvatarUrl: "/api/avatar/a.webp" }));
    expect(card?.name).toBe("TTV Builder");
    expect(card?.image).toBe("/api/avatar/a.webp");
  });

  it("tolerates missing optional fields", () => {
    const card = toHomepageBuilder(
      profile({ headline: "   ", country: null, skills: null, highlights: [], user: { programApplications: [{ ...completed, program: null }] } }),
    );
    expect(card).toMatchObject({ headline: null, country: null, skills: [], project: null, cohort: null });
  });
});
