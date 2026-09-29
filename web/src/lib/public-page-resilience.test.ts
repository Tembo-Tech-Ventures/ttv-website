import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const homepageSource = readFileSync(
  new URL("../pages/index.astro", import.meta.url),
  "utf8"
);
const profileSource = readFileSync(
  new URL("../pages/talent/[handle].astro", import.meta.url),
  "utf8"
);

describe("public page overload wiring", () => {
  it("keeps the homepage available with an empty optional-post fallback", () => {
    expect(homepageSource).toContain("loadPublicPageData({");
    expect(homepageSource).toContain("fallback: []");
    expect(homepageSource).toContain('route: "/"');
    expect(homepageSource).toContain("const latestPosts = latestPostsRead.data");
  });

  it("distinguishes a temporarily unavailable profile from an unpublished one", () => {
    expect(profileSource).toContain('route: "/talent/:handle"');
    expect(profileSource).toContain("if (!profileRead.available)");
    expect(profileSource).toContain("markPublicDataUnavailable(Astro.response)");
    expect(profileSource).toContain("This profile is temporarily unavailable");
    expect(profileSource).toContain("else if (!profile)");
    expect(profileSource).toContain("Astro.response.status = 404");
  });
});
