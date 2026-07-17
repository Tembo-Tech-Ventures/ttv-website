import { describe, expect, it } from "vitest";
import { needsAdminContext } from "@/lib/admin-context";

describe("needsAdminContext", () => {
  it("loads role context for admin and every chat API route", () => {
    expect(needsAdminContext("/admin")).toBe(true);
    expect(needsAdminContext("/api/admin/programs")).toBe(true);
    expect(needsAdminContext("/api/chat/conversations/abc/messages")).toBe(true);
  });

  it("does not add a role lookup to unrelated requests", () => {
    expect(needsAdminContext("/dashboard/ask")).toBe(false);
    expect(needsAdminContext("/api/health")).toBe(false);
  });
});
