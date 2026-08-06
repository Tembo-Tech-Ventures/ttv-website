import { describe, expect, it } from "vitest";
import {
  parseProfileEditor,
  serializeSkills,
  parseSkillsJson,
  parseTopicsJson,
} from "./profile";

describe("parseProfileEditor", () => {
  it("accepts a valid full input", () => {
    const result = parseProfileEditor({
      headline: "Full-stack developer",
      bio: "I build things.",
      location: "Nairobi",
      country: "Kenya",
      skills: ["TypeScript", "React"],
      portfolioUrl: "https://example.com",
      linkedinUrl: "https://linkedin.com/in/test",
      openToFreelance: true,
      openToRoles: false,
    });
    expect(result.success).toBe(true);
  });

  it("accepts an empty object", () => {
    const result = parseProfileEditor({});
    expect(result.success).toBe(true);
  });

  it("accepts empty strings for URL fields", () => {
    const result = parseProfileEditor({
      portfolioUrl: "",
      linkedinUrl: "",
    });
    expect(result.success).toBe(true);
  });

  it("rejects headline over 120 chars", () => {
    const result = parseProfileEditor({ headline: "a".repeat(121) });
    expect(result.success).toBe(false);
  });

  it("rejects bio over 4000 chars", () => {
    const result = parseProfileEditor({ bio: "a".repeat(4001) });
    expect(result.success).toBe(false);
  });

  it("rejects location over 120 chars", () => {
    const result = parseProfileEditor({ location: "a".repeat(121) });
    expect(result.success).toBe(false);
  });

  it("rejects country over 56 chars", () => {
    const result = parseProfileEditor({ country: "a".repeat(57) });
    expect(result.success).toBe(false);
  });

  it("rejects more than 12 skills", () => {
    const skills = Array.from({ length: 13 }, (_, i) => `skill-${i}`);
    const result = parseProfileEditor({ skills });
    expect(result.success).toBe(false);
  });

  it("rejects skill tags over 30 chars", () => {
    const result = parseProfileEditor({ skills: ["a".repeat(31)] });
    expect(result.success).toBe(false);
  });

  it("rejects empty skill tags", () => {
    const result = parseProfileEditor({ skills: [""] });
    expect(result.success).toBe(false);
  });

  it("rejects non-HTTPS URLs", () => {
    const result = parseProfileEditor({
      portfolioUrl: "http://example.com",
    });
    expect(result.success).toBe(false);
  });

  it("rejects URLs over 300 chars", () => {
    const result = parseProfileEditor({
      portfolioUrl: `https://example.com/${"a".repeat(290)}`,
    });
    expect(result.success).toBe(false);
  });
});

describe("serializeSkills", () => {
  it("serializes an array to JSON", () => {
    expect(serializeSkills(["TypeScript", "React"])).toBe(
      '["TypeScript","React"]'
    );
  });

  it("serializes an empty array", () => {
    expect(serializeSkills([])).toBe("[]");
  });
});

describe("parseSkillsJson", () => {
  it("parses a valid JSON array", () => {
    expect(parseSkillsJson('["TypeScript","React"]')).toEqual([
      "TypeScript",
      "React",
    ]);
  });

  it("returns empty array for null/undefined", () => {
    expect(parseSkillsJson(null)).toEqual([]);
    expect(parseSkillsJson(undefined)).toEqual([]);
  });

  it("returns empty array for empty string", () => {
    expect(parseSkillsJson("")).toEqual([]);
  });

  it("returns empty array for malformed JSON", () => {
    expect(parseSkillsJson("{not json")).toEqual([]);
  });

  it("returns empty array for non-array JSON", () => {
    expect(parseSkillsJson('{"key":"value"}')).toEqual([]);
  });

  it("filters out non-string items", () => {
    expect(parseSkillsJson('[1, "valid", true, null]')).toEqual(["valid"]);
  });
});

describe("parseTopicsJson", () => {
  it("delegates to the same logic as parseSkillsJson", () => {
    expect(parseTopicsJson('["a","b"]')).toEqual(["a", "b"]);
    expect(parseTopicsJson(null)).toEqual([]);
  });
});
