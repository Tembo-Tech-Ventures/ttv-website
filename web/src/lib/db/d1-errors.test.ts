import { describe, expect, it } from "vitest";
import {
  d1OverloadMessage,
  isD1OverloadError,
  isD1TransientError,
  retryTransientD1,
} from "./d1-errors";

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

describe("retryTransientD1", () => {
  const lost = () =>
    new Error("Failed query", { cause: new Error("D1_ERROR: Network connection lost.") });

  it("treats a dropped connection as transient but not as an overload", () => {
    expect(isD1TransientError(lost())).toBe(true);
    expect(isD1OverloadError(lost())).toBe(false);
    expect(isD1TransientError(new Error("D1_ERROR: UNIQUE constraint failed"))).toBe(false);
  });

  it("retries transient failures and passes the attempt number", async () => {
    const seen: number[] = [];
    const result = await retryTransientD1(
      async (attempt) => {
        seen.push(attempt);
        if (attempt < 3) throw lost();
        return "done";
      },
      { delayMs: 0 }
    );
    expect(result).toBe("done");
    expect(seen).toEqual([1, 2, 3]);
  });

  it("gives up after the last attempt and never retries other errors", async () => {
    let calls = 0;
    await expect(
      retryTransientD1(
        async () => {
          calls += 1;
          throw lost();
        },
        { attempts: 2, delayMs: 0 }
      )
    ).rejects.toThrow("Failed query");
    expect(calls).toBe(2);

    calls = 0;
    await expect(
      retryTransientD1(
        async () => {
          calls += 1;
          throw new Error("D1_ERROR: no such table");
        },
        { delayMs: 0 }
      )
    ).rejects.toThrow("no such table");
    expect(calls).toBe(1);
  });
});
