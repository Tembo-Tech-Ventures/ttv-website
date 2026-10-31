import { describe, expect, it } from "vitest";
import { demoPathAllowed, type DemoPersona } from "@/lib/staging-demo-policy";
import { qaPathAllowed, QA_PERSONAS } from "@/lib/staging-qa-policy";
import { stagingFixturePathAllowed } from "@/lib/staging-fixture-policy";
import { SPACE_REDIRECTS } from "./space-routes";

describe("canonical aliases retain each existing synthetic-identity boundary", () => {
  it.each(SPACE_REDIRECTS)("preserves the allowlist for %s -> %s", (old, target) => {
    for (const method of ["GET", "HEAD", "POST", "PUT", "DELETE"]) {
      const legacy = old.replace(":id", "synthetic-id");
      const canonical = target.replace(":id", "synthetic-id");
      expect(demoPathAllowed(canonical, method)).toBe(demoPathAllowed(legacy, method));
      expect(stagingFixturePathAllowed(canonical)).toBe(stagingFixturePathAllowed(legacy));
      for (const persona of QA_PERSONAS as DemoPersona[]) {
        expect(qaPathAllowed(persona, canonical, method)).toBe(qaPathAllowed(persona, legacy, method));
      }
    }
  });

  it.each(["/dashboard/me", "/dashboard/me/portfolio", "/dashboard/account", "/dashboard/cohort/sessions/private", "/dashboard/cohort/apply", "/dashboard/community/dm/private", "/dashboard/mentoring/requests", "/dashboard/mentoring/availability", "/dashboard/mentoring/confirm/private"])("does not broaden restricted access to %s", path => {
    for (const method of ["GET", "HEAD", "POST"]) {
      expect(demoPathAllowed(path, method)).toBe(false);
      expect(stagingFixturePathAllowed(path)).toBe(false);
      for (const persona of QA_PERSONAS as DemoPersona[]) expect(qaPathAllowed(persona, path, method)).toBe(false);
    }
  });

  it("keeps canonical cohort applications bound to the existing exact QA application", () => {
    const owned = "/dashboard/cohort/application/ttv-staging-demo-v1-member-cohort-application";
    for (const persona of QA_PERSONAS as DemoPersona[]) {
      // The frozen QA persona set is intentionally not expanded by route migration.
      expect(qaPathAllowed(persona, owned, "GET")).toBe(qaPathAllowed(persona, owned.replace("/cohort", ""), "GET"));
      expect(qaPathAllowed(persona, owned + "-other", "GET")).toBe(false);
      expect(qaPathAllowed(persona, owned, "POST")).toBe(false);
    }
  });
});
