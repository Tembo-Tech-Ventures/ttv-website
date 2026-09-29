import { describe, expect, it } from "vitest";
import { d1OverloadMessage, isD1OverloadError } from "./d1-errors";

describe("D1 overload detection", () => {
  it("finds the retryable D1 failure through Drizzle's cause chain", () => {
    const boundValue = "private-profile-handle";
    const drizzleError = new Error(`Failed query with params: ${boundValue}`, {
      cause: new Error(
        "D1_ERROR: D1 DB is overloaded. Requests queued for too long."
      ),
    });

    expect(isD1OverloadError(drizzleError)).toBe(true);
    expect(d1OverloadMessage(drizzleError)).toBe(
      "D1_ERROR: D1 DB is overloaded. Requests queued for too long."
    );
    expect(d1OverloadMessage(drizzleError)).not.toContain(boundValue);
  });

  it("does not classify unrelated database failures as overloads", () => {
    expect(isD1OverloadError(new Error("D1_ERROR: no such table"))).toBe(false);
  });
});
