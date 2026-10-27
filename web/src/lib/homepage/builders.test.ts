import { describe, expect, it, vi } from "vitest";
import { loadHomepageBuildersSafely, toHomepageBuilder, type BuilderProfileRow } from "./builders";

const recordErrorInBackground = vi.hoisted(() => vi.fn());
vi.mock("@/lib/observability/errors", () => ({ recordErrorInBackground }));

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

describe("loadHomepageBuildersSafely", () => {
  function d1Failing(message: string): D1Database {
    return {
      prepare() {
        throw new Error("Failed query", { cause: new Error(message) });
      },
    } as unknown as D1Database;
  }

  it("keeps the homepage up with no showcase when D1 is overloaded", async () => {
    const builders = await loadHomepageBuildersSafely({
      d1: d1Failing("D1_ERROR: D1 DB is overloaded. Requests queued for too long."),
      route: "/",
    });
    expect(builders).toEqual([]);
    expect(recordErrorInBackground).toHaveBeenCalledWith(
      undefined,
      expect.anything(),
      expect.objectContaining({ route: "/" }),
    );
  });

  it("lets any other database failure reach the error boundary", async () => {
    await expect(
      loadHomepageBuildersSafely({ d1: d1Failing("no such table: studentProfile"), route: "/" }),
    ).rejects.toThrow("Failed query");
  });
});
