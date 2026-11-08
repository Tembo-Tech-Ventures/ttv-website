import { describe, expect, it } from "vitest";
import * as schema from "@/lib/db/schema";
import { emptyFilterCopy } from "./applications";

describe("the applications list's empty filters", () => {
  it("never says an application in review was decided", () => {
    const pending = emptyFilterCopy("PENDING");
    expect(pending.title).toBe("No applications in review");
    expect(pending.body).not.toMatch(/decides|decided|accepts|declines/);
  });

  it("names every stored status in words, with APPROVED read as accepted", () => {
    for (const status of schema.programApplication.status.enumValues) {
      const { title, body } = emptyFilterCopy(status);
      expect.soft(title, status).not.toMatch(/[A-Z]{3,}/);
      expect.soft(body, status).toMatch(/\.$/);
    }
    expect(emptyFilterCopy("APPROVED").title).toBe("No accepted applications");
  });
});
