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

  it("posts every form to the page itself, never to a #fragment, so a focused notice takes focus", () => {
    // A browser skips autofocus when the address targets an element; the confirm step and a rejected
    // form's notice would render unfocused.
    expect(pageSource).not.toMatch(/method="POST"[^>]*action=\{`[^`]*#/);
    expect(pageSource).not.toMatch(/action=\{`\$\{page\}#/);
  });
});
