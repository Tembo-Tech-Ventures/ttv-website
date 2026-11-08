import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const pageSource = readFileSync(new URL("../../pages/admin/users/[id].astro", import.meta.url), "utf8");

describe("admin user detail page wiring", () => {
  it("answers a refused role change with 400 and a database failure with 503, the page shown either way", () => {
    expect(pageSource).toContain("Astro.response.status = error instanceof AdminRoleOperationError ? 400 : 503;");
    // A mentor or institution change that fails in the store answers 500, and agent credentials 403.
    expect(pageSource).toContain("Astro.response.status = 500;");
    expect(pageSource).toContain("Astro.response.status = 403;");
    expect(pageSource).not.toMatch(/throw error;/);
  });
});
