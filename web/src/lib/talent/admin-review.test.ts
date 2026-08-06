import { describe, expect, it } from "vitest";
import {
  sortProfilesForQueue,
  sortProjectsForQueue,
  validateProfileTransition,
  validateProjectTransition,
  shouldSetPublishedAt,
  separateInterests,
} from "./admin-review";

describe("sortProfilesForQueue", () => {
  it("places IN_REVIEW before other statuses", () => {
    const profiles = [
      { status: "PUBLISHED", updatedAt: new Date("2026-01-03") },
      { status: "IN_REVIEW", updatedAt: new Date("2026-01-01") },
      { status: "DRAFT", updatedAt: new Date("2026-01-02") },
    ];
    const sorted = sortProfilesForQueue(profiles);
    expect(sorted.map((p) => p.status)).toEqual([
      "IN_REVIEW",
      "DRAFT",
      "PUBLISHED",
    ]);
  });

  it("sorts same-status profiles by updatedAt descending", () => {
    const profiles = [
      { status: "IN_REVIEW", updatedAt: new Date("2026-01-01") },
      { status: "IN_REVIEW", updatedAt: new Date("2026-01-03") },
      { status: "IN_REVIEW", updatedAt: new Date("2026-01-02") },
    ];
    const sorted = sortProfilesForQueue(profiles);
    expect(sorted.map((p) => p.updatedAt!.toISOString().slice(0, 10))).toEqual([
      "2026-01-03",
      "2026-01-02",
      "2026-01-01",
    ]);
  });

  it("handles null updatedAt", () => {
    const profiles = [
      { status: "DRAFT", updatedAt: null },
      { status: "DRAFT", updatedAt: new Date("2026-01-01") },
    ];
    const sorted = sortProfilesForQueue(profiles);
    expect(sorted[0].updatedAt).not.toBeNull();
  });

  it("does not mutate the input array", () => {
    const profiles = [
      { status: "PUBLISHED", updatedAt: new Date("2026-01-01") },
      { status: "IN_REVIEW", updatedAt: new Date("2026-01-01") },
    ];
    const original = [...profiles];
    sortProfilesForQueue(profiles);
    expect(profiles).toEqual(original);
  });
});

describe("sortProjectsForQueue", () => {
  it("places PENDING before other statuses", () => {
    const projects = [
      { status: "APPROVED", createdAt: new Date("2026-01-03") },
      { status: "PENDING", createdAt: new Date("2026-01-01") },
      { status: "CLOSED", createdAt: new Date("2026-01-02") },
    ];
    const sorted = sortProjectsForQueue(projects);
    expect(sorted.map((p) => p.status)).toEqual([
      "PENDING",
      "APPROVED",
      "CLOSED",
    ]);
  });

  it("sorts same-status projects by createdAt descending", () => {
    const projects = [
      { status: "PENDING", createdAt: new Date("2026-01-01") },
      { status: "PENDING", createdAt: new Date("2026-01-03") },
    ];
    const sorted = sortProjectsForQueue(projects);
    expect(sorted[0].createdAt!.toISOString().slice(0, 10)).toBe("2026-01-03");
  });

  it("puts REJECTED and CLOSED at the end", () => {
    const projects = [
      { status: "REJECTED", createdAt: new Date("2026-01-01") },
      { status: "MATCHED", createdAt: new Date("2026-01-01") },
      { status: "CLOSED", createdAt: new Date("2026-01-01") },
    ];
    const sorted = sortProjectsForQueue(projects);
    expect(sorted.map((p) => p.status)).toEqual([
      "MATCHED",
      "REJECTED",
      "CLOSED",
    ]);
  });
});

describe("validateProfileTransition", () => {
  it("accepts IN_REVIEW → PUBLISHED", () => {
    expect(validateProfileTransition("IN_REVIEW", "PUBLISHED")).toEqual({
      valid: true,
    });
  });

  it("accepts IN_REVIEW → DRAFT", () => {
    expect(validateProfileTransition("IN_REVIEW", "DRAFT")).toEqual({
      valid: true,
    });
  });

  it("accepts PUBLISHED → SUSPENDED", () => {
    expect(validateProfileTransition("PUBLISHED", "SUSPENDED")).toEqual({
      valid: true,
    });
  });

  it("accepts SUSPENDED → PUBLISHED", () => {
    expect(validateProfileTransition("SUSPENDED", "PUBLISHED")).toEqual({
      valid: true,
    });
  });

  it("rejects DRAFT → PUBLISHED (must go through review)", () => {
    const result = validateProfileTransition("DRAFT", "PUBLISHED");
    expect(result.valid).toBe(false);
  });

  it("rejects PUBLISHED → DRAFT", () => {
    const result = validateProfileTransition("PUBLISHED", "DRAFT");
    expect(result.valid).toBe(false);
  });

  it("rejects unknown source status", () => {
    const result = validateProfileTransition("NONEXISTENT", "PUBLISHED");
    expect(result.valid).toBe(false);
  });

  it("includes from/to in error reason", () => {
    const result = validateProfileTransition("DRAFT", "SUSPENDED");
    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.reason).toContain("DRAFT");
      expect(result.reason).toContain("SUSPENDED");
    }
  });
});

describe("validateProjectTransition", () => {
  it("accepts PENDING → APPROVED", () => {
    expect(validateProjectTransition("PENDING", "APPROVED")).toEqual({
      valid: true,
    });
  });

  it("accepts PENDING → REJECTED", () => {
    expect(validateProjectTransition("PENDING", "REJECTED")).toEqual({
      valid: true,
    });
  });

  it("accepts APPROVED → MATCHED", () => {
    expect(validateProjectTransition("APPROVED", "MATCHED")).toEqual({
      valid: true,
    });
  });

  it("accepts APPROVED → CLOSED", () => {
    expect(validateProjectTransition("APPROVED", "CLOSED")).toEqual({
      valid: true,
    });
  });

  it("accepts MATCHED → CLOSED", () => {
    expect(validateProjectTransition("MATCHED", "CLOSED")).toEqual({
      valid: true,
    });
  });

  it("rejects REJECTED → APPROVED (terminal state)", () => {
    const result = validateProjectTransition("REJECTED", "APPROVED");
    expect(result.valid).toBe(false);
  });

  it("rejects CLOSED → APPROVED (terminal state)", () => {
    const result = validateProjectTransition("CLOSED", "APPROVED");
    expect(result.valid).toBe(false);
  });

  it("rejects PENDING → MATCHED (must approve first)", () => {
    const result = validateProjectTransition("PENDING", "MATCHED");
    expect(result.valid).toBe(false);
  });
});

describe("shouldSetPublishedAt", () => {
  it("returns true on first publish", () => {
    expect(shouldSetPublishedAt("PUBLISHED", null)).toBe(true);
  });

  it("returns false if already published before (republish preserves original)", () => {
    expect(shouldSetPublishedAt("PUBLISHED", new Date("2026-01-01"))).toBe(
      false
    );
  });

  it("returns false for non-PUBLISHED transitions", () => {
    expect(shouldSetPublishedAt("DRAFT", null)).toBe(false);
    expect(shouldSetPublishedAt("SUSPENDED", null)).toBe(false);
    expect(shouldSetPublishedAt("IN_REVIEW", null)).toBe(false);
  });
});

describe("separateInterests", () => {
  it("separates INTERESTED from WITHDRAWN", () => {
    const interests = [
      { status: "INTERESTED", name: "A" },
      { status: "WITHDRAWN", name: "B" },
      { status: "INTERESTED", name: "C" },
    ];
    const { interested, withdrawn } = separateInterests(interests);
    expect(interested).toHaveLength(2);
    expect(withdrawn).toHaveLength(1);
    expect(interested.map((i) => i.name)).toEqual(["A", "C"]);
    expect(withdrawn.map((i) => i.name)).toEqual(["B"]);
  });

  it("returns empty arrays when no interests", () => {
    const { interested, withdrawn } = separateInterests([]);
    expect(interested).toHaveLength(0);
    expect(withdrawn).toHaveLength(0);
  });

  it("handles all INTERESTED", () => {
    const interests = [
      { status: "INTERESTED" },
      { status: "INTERESTED" },
    ];
    const { interested, withdrawn } = separateInterests(interests);
    expect(interested).toHaveLength(2);
    expect(withdrawn).toHaveLength(0);
  });

  it("handles all WITHDRAWN", () => {
    const interests = [{ status: "WITHDRAWN" }];
    const { interested, withdrawn } = separateInterests(interests);
    expect(interested).toHaveLength(0);
    expect(withdrawn).toHaveLength(1);
  });
});
