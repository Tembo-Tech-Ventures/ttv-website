import { describe, expect, it } from "vitest";
import { memberRoute } from "@/lib/platform/server/space-routes";
import { memberProfileHref, memberWorkHref } from "./links";

describe("member links in the app", () => {
  it("lead everyone to their member page, graduates on the public site included", () => {
    expect(memberProfileHref({ handle: "wanjiku-mwangi" })).toBe("/dashboard/community/members/wanjiku-mwangi");
    // Whatever else a caller passes, the in-app link never leaves the app.
    expect(memberProfileHref({ handle: "achieng-otieno", onPublicSite: true } as { handle: string })).toBe("/dashboard/community/members/achieng-otieno");
    expect(memberRoute(memberProfileHref({ handle: "achieng-otieno" }))).toEqual({ handle: "achieng-otieno" });
  });

  it("lead to one piece of work on the member's page", () => {
    expect(memberWorkHref({ handle: "achieng-otieno" }, "work 1")).toBe("/dashboard/community/members/achieng-otieno#work-work%201");
  });
});
