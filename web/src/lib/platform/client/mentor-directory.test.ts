import { describe, expect, it } from "vitest";
import { MentorDirectoryQuery } from "../contracts";
import { mentors } from "../fixtures";
import {
  areaOptions, askHref, directoryHref, directoryQuery, directorySearch, filterDirectory, hasOpenSpot,
  NO_FILTERS, parseDirectoryUrl, sameArea,
} from "./mentor-directory";

const PATH = "/dashboard/community/mentors";
const parse = (search: string) => parseDirectoryUrl(new URLSearchParams(search));

describe("directory URL state", () => {
  it("reads every filter and the open drawer from the query string", () => {
    expect(parse("?area=Code%20review&format=WRITTEN_REVIEW&available=true&ask=mentor-1")).toEqual({
      area: "Code review", format: "WRITTEN_REVIEW", available: true, ask: "mentor-1",
    });
  });

  it("opens the whole directory for an empty or stale link instead of failing", () => {
    expect(parse("")).toEqual({ ...NO_FILTERS, ask: null });
    expect(parse(`?area=${"x".repeat(41)}&format=LUNCH&available=yes&ask=a/b`)).toEqual({ ...NO_FILTERS, ask: null });
    expect(parse("?area=%20%20&available=1").area).toBeNull();
    expect(parse("?available=false").available).toBe(false);
  });

  it("trims an area so a padded link matches the same filter", () => {
    expect(parse("?area=%20Mobile%20").area).toBe("Mobile");
  });

  it("writes a stable query string, round-tripping through the parser", () => {
    const state = { area: "UX critique", format: "QUICK_QUESTION" as const, available: true, ask: "m 2" };
    const search = directorySearch(state);
    expect(search).toBe("?area=UX+critique&format=QUICK_QUESTION&available=true&ask=m+2");
    expect(parse(search)).toEqual({ ...state, ask: null });
    expect(parse(directorySearch({ ...state, ask: "m2" }))).toEqual({ ...state, ask: "m2" });
    expect(directorySearch(NO_FILTERS)).toBe("");
  });

  it("links a filter change, dropping the drawer, and opens a drawer without losing the filters", () => {
    const filters = { area: "Career", format: null, available: false };
    expect(directoryHref(PATH, filters, { available: true })).toBe(`${PATH}?area=Career&available=true`);
    expect(directoryHref(PATH, filters, { area: null })).toBe(PATH);
    expect(askHref(PATH, filters, "mentor-9")).toBe(`${PATH}?area=Career&ask=mentor-9`);
  });

  it("builds the server query the contract accepts", () => {
    expect(directoryQuery(NO_FILTERS)).toEqual({});
    const query = directoryQuery({ area: "Mobile", format: "CALL_30_MIN", available: true });
    expect(MentorDirectoryQuery.parse(query)).toEqual({ area: "Mobile", format: "CALL_30_MIN", available: true });
  });
});

describe("area options", () => {
  it("offers each area once, ignoring case, the most shared first", () => {
    const items = [
      { areas: ["Code review", "API design"] },
      { areas: ["code review", "Career"] },
      { areas: ["Career", "career", "Mobile"] },
    ];
    expect(areaOptions(items)).toEqual(["Career", "Code review", "API design", "Mobile"]);
  });

  it("keeps an active area nobody lists any more, so it can be cleared", () => {
    expect(areaOptions([{ areas: ["Mobile"] }], "Data")).toEqual(["Mobile", "Data"]);
    expect(areaOptions([{ areas: ["Mobile"] }], "mobile")).toEqual(["Mobile"]);
  });

  it("compares areas ignoring case and padding", () => {
    expect(sameArea(" Code Review", "code review")).toBe(true);
    expect(sameArea("Code", "Code review")).toBe(false);
  });
});

describe("filtering the unfiltered list", () => {
  it("filters as GET /api/mentors does (src/lib/mentoring/http.test.ts holds it to the SQL)", () => {
    const names = (filters: Parameters<typeof filterDirectory>[1]) =>
      filterDirectory(mentors.items, filters).map(item => item.person.name);
    expect(names(NO_FILTERS)).toHaveLength(4);
    expect(names({ ...NO_FILTERS, area: "code REVIEW" })).toEqual(["David Kamau"]);
    expect(names({ ...NO_FILTERS, format: "QUICK_QUESTION" })).toEqual(["Mercy Wambui", "Joseph Mutua", "Samuel Otieno"]);
    // Mercy is full this month: listed, but not "available now".
    expect(names({ ...NO_FILTERS, available: true })).not.toContain("Mercy Wambui");
    expect(hasOpenSpot(mentors.items[1])).toBe(false);
  });
});
