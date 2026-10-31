import { describe, expect, it } from "vitest";
import { existsSync } from "node:fs";
import { canonicalSpacePath, isAvailableSpacePath, legacySpacePath, spaceForPath, SPACE_REDIRECTS } from "./space-routes";

const redirects = [
  ["apply", "cohort/apply"], ["application/synthetic-application", "cohort/application/synthetic-application"],
  ["sessions", "cohort/sessions"], ["sessions/synthetic-recording", "cohort/sessions/synthetic-recording"],
  ["ask", "cohort/ask"], ["mentorship", "mentoring/confirm"],
  ["portfolio", "me/portfolio"], ["writing", "me/writing"], ["writing/new", "me/writing/new"],
  ["writing/synthetic-post", "me/writing/synthetic-post"], ["opportunities", "me/opportunities"],
  ["leads", "me/leads"], ["profile", "account"],
];

describe("the complete legacy redirect table", () => {
  it.each(redirects)("maps %s to %s and resolves to its existing page", (old, target) => {
    for (const suffix of ["", "/"]) {
      expect(canonicalSpacePath(`/dashboard/${old}${suffix}`)).toBe(`/dashboard/${target}`);
      expect(legacySpacePath(`/dashboard/${target}${suffix}`)).toBe(`/dashboard/${old}`);
      expect(isAvailableSpacePath(`/dashboard/${target}${suffix}`)).toBe(true);
      expect(canonicalSpacePath(`/dashboard/${target}${suffix}`)).toBeNull();
    }
  });

  it("every render target exists, including dynamic routes and root aliases", () => {
    const targets = [...SPACE_REDIRECTS.map(([legacy]) => legacy), "/dashboard", "/dashboard/community", "/dashboard/discover"];
    for (const target of targets) {
      const file = `src/pages${target.replace(":id", "[id]")}`;
      expect(existsSync(`${file}.astro`) || existsSync(`${file}/index.astro`)).toBe(true);
    }
    expect(legacySpacePath("/dashboard/me")).toBe("/dashboard/portfolio");
    expect(legacySpacePath("/dashboard/cohort")).toBe("/dashboard");
    expect(legacySpacePath("/dashboard/mentoring")).toBe("/dashboard/mentorship");
  });

  it.each(["/dashboard/sessions/x/y", "/dashboard/writing/x/edit", "/dashboard/application/x/y", "/dashboard/sessions/x%2Fy", "/dashboard/writing/x%5cy", "/dashboard/portfolio-other"])("does not broaden legacy matches: %s", path => {
    expect(canonicalSpacePath(path)).toBeNull();
  });

  it.each(["/dashboard/cohort/c/example", "/dashboard/community/c/example", "/dashboard/community/dm/example", "/dashboard/mentoring/requests", "/dashboard/mentoring/availability", "/dashboard/me/certificates", "/dashboard/account/security"])("does not invent unshipped pages: %s", path => {
    expect(isAvailableSpacePath(path)).toBe(false);
  });

  it("matches space boundaries and the account/profile distinction", () => {
    expect(spaceForPath("/dashboard/me/writing")).toBe("profile");
    expect(spaceForPath("/dashboard/account")).toBe("profile");
    expect(spaceForPath("/dashboard/community")).toBe("community");
    expect(spaceForPath("/dashboard/mentoring-other")).toBeNull();
    expect(spaceForPath("/dashboard/profile")).toBeNull();
  });
});
