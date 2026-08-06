import { describe, expect, it } from "vitest";
import {
  PROFILE_TRANSITIONS,
  PROJECT_TRANSITIONS,
  canTransition,
} from "./transitions";

describe("PROFILE_TRANSITIONS", () => {
  it("allows DRAFT → IN_REVIEW", () => {
    expect(canTransition(PROFILE_TRANSITIONS, "DRAFT", "IN_REVIEW")).toBe(true);
  });

  it("allows IN_REVIEW → PUBLISHED and IN_REVIEW → DRAFT", () => {
    expect(canTransition(PROFILE_TRANSITIONS, "IN_REVIEW", "PUBLISHED")).toBe(
      true
    );
    expect(canTransition(PROFILE_TRANSITIONS, "IN_REVIEW", "DRAFT")).toBe(true);
  });

  it("allows PUBLISHED → SUSPENDED", () => {
    expect(canTransition(PROFILE_TRANSITIONS, "PUBLISHED", "SUSPENDED")).toBe(
      true
    );
  });

  it("allows SUSPENDED → PUBLISHED", () => {
    expect(canTransition(PROFILE_TRANSITIONS, "SUSPENDED", "PUBLISHED")).toBe(
      true
    );
  });

  it("disallows invalid transitions", () => {
    expect(canTransition(PROFILE_TRANSITIONS, "DRAFT", "PUBLISHED")).toBe(
      false
    );
    expect(canTransition(PROFILE_TRANSITIONS, "DRAFT", "SUSPENDED")).toBe(
      false
    );
    expect(canTransition(PROFILE_TRANSITIONS, "PUBLISHED", "DRAFT")).toBe(
      false
    );
  });
});

describe("PROJECT_TRANSITIONS", () => {
  it("allows PENDING → APPROVED and PENDING → REJECTED", () => {
    expect(canTransition(PROJECT_TRANSITIONS, "PENDING", "APPROVED")).toBe(
      true
    );
    expect(canTransition(PROJECT_TRANSITIONS, "PENDING", "REJECTED")).toBe(
      true
    );
  });

  it("allows APPROVED → CLOSED and APPROVED → MATCHED", () => {
    expect(canTransition(PROJECT_TRANSITIONS, "APPROVED", "CLOSED")).toBe(true);
    expect(canTransition(PROJECT_TRANSITIONS, "APPROVED", "MATCHED")).toBe(
      true
    );
  });

  it("allows MATCHED → CLOSED", () => {
    expect(canTransition(PROJECT_TRANSITIONS, "MATCHED", "CLOSED")).toBe(true);
  });

  it("disallows transitions from terminal states", () => {
    expect(canTransition(PROJECT_TRANSITIONS, "REJECTED", "APPROVED")).toBe(
      false
    );
    expect(canTransition(PROJECT_TRANSITIONS, "CLOSED", "APPROVED")).toBe(
      false
    );
  });

  it("returns false for unknown states", () => {
    expect(canTransition(PROJECT_TRANSITIONS, "UNKNOWN", "APPROVED")).toBe(
      false
    );
  });
});
