import { describe, expect, it } from "vitest";
import { people } from "@/lib/platform/fixtures";
import { insertMention, mentionCandidates, mentionQuery } from "./mentions";

const everyone = [people.david, people.achieng, people.kevin, people.wanjiku];
const inThread = new Set([people.david.id, people.achieng.id]);
const base = {
  people: everyone, tembo: true, temboDescription: "Answers from this thread",
  where: (person: { id: string | null }) => (inThread.has(person.id ?? "") ? "in this thread" : "in this channel"),
};

describe("mentionQuery", () => {
  it("reads the word after an @ at the caret", () => {
    expect(mentionQuery("@t", 2)).toEqual({ start: 0, query: "t" });
    expect(mentionQuery("ask @Dav", 8)).toEqual({ start: 4, query: "Dav" });
    expect(mentionQuery("ask @David K", 12)).toEqual({ start: 4, query: "David K" });
    expect(mentionQuery("(@", 2)).toEqual({ start: 1, query: "" });
  });

  it("ignores email addresses, finished mentions and text after the caret", () => {
    expect(mentionQuery("me@example", 10)).toBeNull();
    expect(mentionQuery("@David Kamau thanks", 19)).toBeNull();
    expect(mentionQuery("@tembo hello", 3)).toEqual({ start: 0, query: "te" });
    expect(mentionQuery("no mention", 10)).toBeNull();
    // A finished mention followed by a space is done: the picker must not reopen on it.
    expect(mentionQuery("@tembo ", 7)).toBeNull();
  });
});

describe("mentionCandidates", () => {
  it("puts Tembo first, then people whose name or surname starts with the query", () => {
    expect(mentionCandidates("", base).map((c) => c.label)).toEqual([
      "@tembo", "@David Kamau", "@Achieng Otieno", "@Kevin Omondi", "@Wanjiku Mwangi",
    ]);
    expect(mentionCandidates("ka", base).map((c) => c.label)).toEqual(["@David Kamau"]);
    expect(mentionCandidates("T", base).map((c) => c.label)).toEqual(["@tembo"]);
  });

  it("leaves Tembo out while tembo_channels is off", () => {
    expect(mentionCandidates("t", { ...base, tembo: false })).toEqual([]);
  });

  it("describes people by the first badge the server sent, never an invented one", () => {
    const [david] = mentionCandidates("david", base);
    expect(david.description).toBe("Mentor · in this thread");
    const unbadged = { ...people.kevin, roleBadges: [] };
    expect(mentionCandidates("kev", { ...base, people: [unbadged] })[0].description).toBe("in this channel");
  });

  it("lists each person once and caps the list", () => {
    expect(mentionCandidates("", { ...base, people: [people.david, people.david], tembo: false })).toHaveLength(1);
    expect(mentionCandidates("", { ...base, limit: 2 })).toHaveLength(2);
  });
});

describe("insertMention", () => {
  it("replaces the typed part and leaves the caret after one space", () => {
    expect(insertMention("hi @da there", 3, 6, "@David Kamau")).toEqual({ text: "hi @David Kamau there", caret: 16 });
    expect(insertMention("@t", 0, 2, "@tembo")).toEqual({ text: "@tembo ", caret: 7 });
  });
});
