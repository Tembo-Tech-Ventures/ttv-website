import { describe, expect, it } from "vitest";
import {
  applicationBadgeVariant,
  applicationStatuses,
  isApplicationStatus,
} from "@/lib/application-status";

describe("application status helpers", () => {
  it("validates only schema-supported statuses", () => {
    for (const status of applicationStatuses) {
      expect(isApplicationStatus(status)).toBe(true);
    }
    expect(isApplicationStatus("ARCHIVED")).toBe(false);
    expect(isApplicationStatus(null)).toBe(false);
  });

  it("maps every status to its presentation variant", () => {
    expect(applicationStatuses.map(applicationBadgeVariant)).toEqual([
      "pending",
      "approved",
      "rejected",
      "audit",
      "completed",
    ]);
  });
});
