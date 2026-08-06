import { describe, it, expect } from "vitest";
import {
  hireFormSchema,
  parseSkillTags,
  interestNoteSchema,
  resolveGateState,
} from "./validation";

const validInput = {
  organization: "Savanna Logistics",
  contactName: "Jane Doe",
  contactEmail: "jane@example.com",
  title: "Delivery tracking dashboard",
  description: "Build a real-time delivery tracking dashboard for our fleet.",
  skillsRaw: "React, TypeScript, PostgreSQL",
  budgetBand: "FROM_1K_TO_5K" as const,
  timeline: "4 weeks",
};

describe("hireFormSchema", () => {
  it("accepts valid input", () => {
    const result = hireFormSchema.safeParse(validInput);
    expect(result.success).toBe(true);
  });

  it("accepts input with optional fields empty", () => {
    const result = hireFormSchema.safeParse({
      ...validInput,
      skillsRaw: "",
      timeline: "",
    });
    expect(result.success).toBe(true);
  });

  it("accepts input without optional fields", () => {
    const { skillsRaw: _, timeline: _t, ...rest } = validInput;
    const result = hireFormSchema.safeParse(rest);
    expect(result.success).toBe(true);
  });

  describe("organization", () => {
    it("rejects empty", () => {
      const result = hireFormSchema.safeParse({ ...validInput, organization: "" });
      expect(result.success).toBe(false);
      expect(result.error?.issues[0]?.message).toContain("Organization");
    });

    it("rejects over 120 chars", () => {
      const result = hireFormSchema.safeParse({
        ...validInput,
        organization: "a".repeat(121),
      });
      expect(result.success).toBe(false);
      expect(result.error?.issues[0]?.message).toContain("120");
    });
  });

  describe("contactName", () => {
    it("rejects empty", () => {
      const result = hireFormSchema.safeParse({ ...validInput, contactName: "" });
      expect(result.success).toBe(false);
      expect(result.error?.issues[0]?.message).toContain("name");
    });

    it("rejects over 120 chars", () => {
      const result = hireFormSchema.safeParse({
        ...validInput,
        contactName: "a".repeat(121),
      });
      expect(result.success).toBe(false);
      expect(result.error?.issues[0]?.message).toContain("120");
    });
  });

  describe("contactEmail", () => {
    it("rejects empty", () => {
      const result = hireFormSchema.safeParse({ ...validInput, contactEmail: "" });
      expect(result.success).toBe(false);
      expect(result.error?.issues[0]?.message).toContain("Email");
    });

    it("rejects invalid email", () => {
      const result = hireFormSchema.safeParse({
        ...validInput,
        contactEmail: "not-an-email",
      });
      expect(result.success).toBe(false);
      expect(result.error?.issues[0]?.message).toContain("valid email");
    });

    it("rejects over 254 chars", () => {
      const result = hireFormSchema.safeParse({
        ...validInput,
        contactEmail: "a".repeat(246) + "@test.com",
      });
      expect(result.success).toBe(false);
      expect(result.error?.issues[0]?.message).toContain("254");
    });
  });

  describe("title", () => {
    it("rejects empty", () => {
      const result = hireFormSchema.safeParse({ ...validInput, title: "" });
      expect(result.success).toBe(false);
      expect(result.error?.issues[0]?.message).toContain("title");
    });

    it("rejects over 160 chars", () => {
      const result = hireFormSchema.safeParse({
        ...validInput,
        title: "a".repeat(161),
      });
      expect(result.success).toBe(false);
      expect(result.error?.issues[0]?.message).toContain("160");
    });
  });

  describe("description", () => {
    it("rejects empty", () => {
      const result = hireFormSchema.safeParse({ ...validInput, description: "" });
      expect(result.success).toBe(false);
      expect(result.error?.issues[0]?.message).toContain("description");
    });

    it("rejects over 4000 chars", () => {
      const result = hireFormSchema.safeParse({
        ...validInput,
        description: "a".repeat(4001),
      });
      expect(result.success).toBe(false);
      expect(result.error?.issues[0]?.message).toContain("4,000");
    });
  });

  describe("budgetBand", () => {
    it("rejects invalid value", () => {
      const result = hireFormSchema.safeParse({
        ...validInput,
        budgetBand: "INVALID",
      });
      expect(result.success).toBe(false);
      expect(result.error?.issues[0]?.message).toContain("budget range");
    });

    it("rejects empty string", () => {
      const result = hireFormSchema.safeParse({
        ...validInput,
        budgetBand: "",
      });
      expect(result.success).toBe(false);
    });

    it("accepts all valid band values", () => {
      for (const band of [
        "UNDER_1K",
        "FROM_1K_TO_5K",
        "FROM_5K_TO_15K",
        "OVER_15K",
        "UNDISCLOSED",
      ]) {
        const result = hireFormSchema.safeParse({
          ...validInput,
          budgetBand: band,
        });
        expect(result.success).toBe(true);
      }
    });
  });

  describe("timeline", () => {
    it("rejects over 120 chars", () => {
      const result = hireFormSchema.safeParse({
        ...validInput,
        timeline: "a".repeat(121),
      });
      expect(result.success).toBe(false);
      expect(result.error?.issues[0]?.message).toContain("120");
    });
  });

  describe("skillsRaw", () => {
    it("rejects over 1000 chars", () => {
      const result = hireFormSchema.safeParse({
        ...validInput,
        skillsRaw: "a".repeat(1001),
      });
      expect(result.success).toBe(false);
    });
  });
});

describe("parseSkillTags", () => {
  it("splits comma-separated values", () => {
    expect(parseSkillTags("React, TypeScript, PostgreSQL")).toEqual([
      "React",
      "TypeScript",
      "PostgreSQL",
    ]);
  });

  it("trims whitespace", () => {
    expect(parseSkillTags("  React  ,  TS  ")).toEqual(["React", "TS"]);
  });

  it("filters empty strings", () => {
    expect(parseSkillTags("React,,, TypeScript")).toEqual([
      "React",
      "TypeScript",
    ]);
  });

  it("limits to 12 tags", () => {
    const input = Array.from({ length: 15 }, (_, i) => `tag${i}`).join(", ");
    expect(parseSkillTags(input)).toHaveLength(12);
  });

  it("truncates individual tags to 30 chars", () => {
    const longTag = "a".repeat(40);
    const result = parseSkillTags(longTag);
    expect(result[0]).toHaveLength(30);
  });

  it("returns empty array for empty string", () => {
    expect(parseSkillTags("")).toEqual([]);
  });

  it("returns empty array for whitespace-only", () => {
    expect(parseSkillTags("   ,  , ")).toEqual([]);
  });
});

describe("interestNoteSchema", () => {
  it("accepts empty string", () => {
    const result = interestNoteSchema.safeParse("");
    expect(result.success).toBe(true);
  });

  it("accepts valid note", () => {
    const result = interestNoteSchema.safeParse("I have experience with React.");
    expect(result.success).toBe(true);
  });

  it("rejects over 500 chars", () => {
    const result = interestNoteSchema.safeParse("a".repeat(501));
    expect(result.success).toBe(false);
    expect(result.error?.issues[0]?.message).toContain("500");
  });

  it("defaults to empty string when undefined", () => {
    const result = interestNoteSchema.safeParse(undefined);
    expect(result.success).toBe(true);
    if (result.success) expect(result.data).toBe("");
  });
});

describe("resolveGateState", () => {
  it("returns no_profile for null", () => {
    const result = resolveGateState(null);
    expect(result.state).toBe("no_profile");
    expect(result.message).toContain("Create and publish");
  });

  it("returns no_profile for undefined", () => {
    const result = resolveGateState(undefined);
    expect(result.state).toBe("no_profile");
  });

  it("returns not_published for DRAFT", () => {
    const result = resolveGateState({ status: "DRAFT" });
    expect(result.state).toBe("not_published");
    expect(result.message).toContain("published");
  });

  it("returns not_published for IN_REVIEW", () => {
    const result = resolveGateState({ status: "IN_REVIEW" });
    expect(result.state).toBe("not_published");
    expect(result.message).toContain("reviewed");
  });

  it("returns not_published for SUSPENDED", () => {
    const result = resolveGateState({ status: "SUSPENDED" });
    expect(result.state).toBe("not_published");
    expect(result.message).toContain("suspended");
  });

  it("returns published for PUBLISHED", () => {
    const result = resolveGateState({ status: "PUBLISHED" });
    expect(result.state).toBe("published");
    expect(result.message).toBe("");
  });
});
