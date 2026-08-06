import { describe, it, expect } from "vitest";
import {
  rotationHash,
  fairSort,
  getInitials,
  parseDirectoryFilters,
  applyFilters,
  collectFilterOptions,
  type DirectoryProfile,
} from "./directory-helpers";

describe("rotationHash", () => {
  it("returns the same value for the same inputs", () => {
    const a = rotationHash("profile-1", "2026-08-06");
    const b = rotationHash("profile-1", "2026-08-06");
    expect(a).toBe(b);
  });

  it("returns different values for different profile IDs", () => {
    const a = rotationHash("profile-1", "2026-08-06");
    const b = rotationHash("profile-2", "2026-08-06");
    expect(a).not.toBe(b);
  });

  it("returns different values for different dates", () => {
    const a = rotationHash("profile-1", "2026-08-06");
    const b = rotationHash("profile-1", "2026-08-07");
    expect(a).not.toBe(b);
  });
});

describe("fairSort", () => {
  const items = [
    { id: "alpha" },
    { id: "beta" },
    { id: "gamma" },
    { id: "delta" },
  ];

  it("produces stable order for the same date key", () => {
    const a = fairSort(items, "2026-08-06");
    const b = fairSort(items, "2026-08-06");
    expect(a.map((x) => x.id)).toEqual(b.map((x) => x.id));
  });

  it("produces a different order for different date keys", () => {
    const manyItems = Array.from({ length: 20 }, (_, i) => ({
      id: `profile-${i}`,
    }));
    const orderings = new Set<string>();
    for (let day = 1; day <= 30; day++) {
      const dateKey = `2026-08-${String(day).padStart(2, "0")}`;
      const order = fairSort(manyItems, dateKey)
        .map((x) => x.id)
        .join(",");
      orderings.add(order);
    }
    expect(orderings.size).toBeGreaterThan(1);
  });

  it("does not mutate the original array", () => {
    const original = [...items];
    fairSort(items, "2026-08-06");
    expect(items).toEqual(original);
  });
});

describe("getInitials", () => {
  it("returns two initials for a full name", () => {
    expect(getInitials("Amina Osei")).toBe("AO");
  });

  it("returns one initial for a single name", () => {
    expect(getInitials("Amina")).toBe("A");
  });

  it("handles three or more name parts", () => {
    expect(getInitials("Amina Kweku Osei")).toBe("AK");
  });

  it("returns ? for null", () => {
    expect(getInitials(null)).toBe("?");
  });

  it("returns ? for undefined", () => {
    expect(getInitials(undefined)).toBe("?");
  });

  it("returns ? for empty string", () => {
    expect(getInitials("")).toBe("?");
  });

  it("returns ? for whitespace-only string", () => {
    expect(getInitials("   ")).toBe("?");
  });

  it("trims whitespace", () => {
    expect(getInitials("  Amina  Osei  ")).toBe("AO");
  });

  it("uppercases initials", () => {
    expect(getInitials("amina osei")).toBe("AO");
  });
});

describe("parseDirectoryFilters", () => {
  it("returns empty filters for no params", () => {
    const params = new URLSearchParams();
    expect(parseDirectoryFilters(params)).toEqual({});
  });

  it("parses skill filter", () => {
    const params = new URLSearchParams("skill=TypeScript");
    expect(parseDirectoryFilters(params)).toEqual({ skill: "TypeScript" });
  });

  it("parses country filter", () => {
    const params = new URLSearchParams("country=Kenya");
    expect(parseDirectoryFilters(params)).toEqual({ country: "Kenya" });
  });

  it("parses availability=freelance", () => {
    const params = new URLSearchParams("availability=freelance");
    expect(parseDirectoryFilters(params)).toEqual({
      availability: "freelance",
    });
  });

  it("parses availability=roles", () => {
    const params = new URLSearchParams("availability=roles");
    expect(parseDirectoryFilters(params)).toEqual({ availability: "roles" });
  });

  it("ignores invalid availability values", () => {
    const params = new URLSearchParams("availability=invalid");
    expect(parseDirectoryFilters(params)).toEqual({});
  });

  it("parses cohort filter", () => {
    const params = new URLSearchParams("cohort=Cohort+04");
    expect(parseDirectoryFilters(params)).toEqual({ cohort: "Cohort 04" });
  });

  it("parses multiple filters", () => {
    const params = new URLSearchParams(
      "skill=React&country=Kenya&availability=freelance&cohort=Cohort+04",
    );
    expect(parseDirectoryFilters(params)).toEqual({
      skill: "React",
      country: "Kenya",
      availability: "freelance",
      cohort: "Cohort 04",
    });
  });

  it("trims whitespace from values", () => {
    const params = new URLSearchParams("skill=+TypeScript+");
    expect(parseDirectoryFilters(params)).toEqual({ skill: "TypeScript" });
  });

  it("ignores empty string values", () => {
    const params = new URLSearchParams("skill=&country=");
    expect(parseDirectoryFilters(params)).toEqual({});
  });
});

function makeProfile(overrides: Partial<DirectoryProfile> = {}): DirectoryProfile {
  return {
    id: "test-id",
    handle: "test-handle",
    headline: "Full-stack developer",
    country: "Kenya",
    skills: JSON.stringify(["TypeScript", "React", "D1"]),
    openToFreelance: true,
    openToRoles: false,
    user: { name: "Test User", image: null },
    completedCohorts: [
      { programName: "Cohort 04", applicationId: "app-1" },
    ],
    ...overrides,
  };
}

describe("applyFilters", () => {
  const profiles = [
    makeProfile({
      id: "1",
      handle: "amina",
      country: "Kenya",
      skills: JSON.stringify(["TypeScript", "React"]),
      openToFreelance: true,
      openToRoles: false,
      completedCohorts: [
        { programName: "Cohort 04", applicationId: "a1" },
      ],
    }),
    makeProfile({
      id: "2",
      handle: "kwame",
      country: "Ghana",
      skills: JSON.stringify(["Python", "Django"]),
      openToFreelance: false,
      openToRoles: true,
      completedCohorts: [
        { programName: "Cohort 03", applicationId: "a2" },
      ],
    }),
    makeProfile({
      id: "3",
      handle: "fatou",
      country: "Senegal",
      skills: JSON.stringify(["TypeScript", "Node.js"]),
      openToFreelance: true,
      openToRoles: true,
      completedCohorts: [],
    }),
  ];

  it("returns all profiles with no filters", () => {
    expect(applyFilters(profiles, {})).toHaveLength(3);
  });

  it("filters by skill (case-insensitive)", () => {
    const result = applyFilters(profiles, { skill: "typescript" });
    expect(result.map((p) => p.handle)).toEqual(["amina", "fatou"]);
  });

  it("filters by country (case-insensitive)", () => {
    const result = applyFilters(profiles, { country: "ghana" });
    expect(result.map((p) => p.handle)).toEqual(["kwame"]);
  });

  it("filters by availability=freelance", () => {
    const result = applyFilters(profiles, { availability: "freelance" });
    expect(result.map((p) => p.handle)).toEqual(["amina", "fatou"]);
  });

  it("filters by availability=roles", () => {
    const result = applyFilters(profiles, { availability: "roles" });
    expect(result.map((p) => p.handle)).toEqual(["kwame", "fatou"]);
  });

  it("filters by cohort", () => {
    const result = applyFilters(profiles, { cohort: "Cohort 04" });
    expect(result.map((p) => p.handle)).toEqual(["amina"]);
  });

  it("applies multiple filters (intersection)", () => {
    const result = applyFilters(profiles, {
      skill: "TypeScript",
      availability: "freelance",
    });
    expect(result.map((p) => p.handle)).toEqual(["amina", "fatou"]);
  });

  it("returns empty array when no profiles match", () => {
    const result = applyFilters(profiles, { skill: "zzz-nonexistent" });
    expect(result).toHaveLength(0);
  });

  it("handles profiles with null skills", () => {
    const withNull = [makeProfile({ id: "4", handle: "null-skills", skills: null })];
    const result = applyFilters(withNull, { skill: "TypeScript" });
    expect(result).toHaveLength(0);
  });
});

describe("collectFilterOptions", () => {
  const profiles = [
    makeProfile({
      id: "1",
      country: "Kenya",
      skills: JSON.stringify(["TypeScript", "React"]),
      completedCohorts: [{ programName: "Cohort 04", applicationId: "a1" }],
    }),
    makeProfile({
      id: "2",
      country: "Ghana",
      skills: JSON.stringify(["Python", "TypeScript"]),
      completedCohorts: [{ programName: "Cohort 03", applicationId: "a2" }],
    }),
  ];

  it("collects unique skills sorted alphabetically", () => {
    const options = collectFilterOptions(profiles);
    expect(options.skills).toEqual(["Python", "React", "TypeScript"]);
  });

  it("collects unique countries sorted alphabetically", () => {
    const options = collectFilterOptions(profiles);
    expect(options.countries).toEqual(["Ghana", "Kenya"]);
  });

  it("collects unique cohorts sorted alphabetically", () => {
    const options = collectFilterOptions(profiles);
    expect(options.cohorts).toEqual(["Cohort 03", "Cohort 04"]);
  });

  it("handles empty profiles array", () => {
    const options = collectFilterOptions([]);
    expect(options).toEqual({ skills: [], countries: [], cohorts: [] });
  });

  it("skips null countries", () => {
    const withNull = [makeProfile({ country: null })];
    const options = collectFilterOptions(withNull);
    expect(options.countries).toEqual([]);
  });
});
