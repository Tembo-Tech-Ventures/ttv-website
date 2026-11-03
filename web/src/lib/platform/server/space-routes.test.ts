import { describe, expect, it } from "vitest";
import { existsSync } from "node:fs";
import {
  canonicalSpacePath, channelPagePath, channelRoute, CONDUCT_PATH, conversationRoute, isAvailableSpacePath, isChannelPagePath,
  isMentorPagePath, isNewSpacePath, legacySpacePath, MENTOR_PAGE_PATHS, spaceForPath, SPACE_REDIRECTS,
} from "./space-routes";

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
    const targets = [...SPACE_REDIRECTS.map(([legacy]) => legacy), "/dashboard", "/dashboard/community", "/dashboard/discover", "/dashboard/me"];
    for (const target of targets) {
      const file = `src/pages${target.replace(":id", "[id]")}`;
      expect(existsSync(`${file}.astro`) || existsSync(`${file}/index.astro`)).toBe(true);
    }
    // The Profile space opens on its own Overview page (T01); the editor is /dashboard/me/portfolio.
    expect(legacySpacePath("/dashboard/me")).toBe("/dashboard/me");
    expect(legacySpacePath("/dashboard/me/portfolio")).toBe("/dashboard/portfolio");
    expect(legacySpacePath("/dashboard/cohort")).toBe("/dashboard");
    expect(legacySpacePath("/dashboard/mentoring")).toBe("/dashboard/mentorship");
  });

  it.each(["/dashboard/sessions/x/y", "/dashboard/writing/x/edit", "/dashboard/application/x/y", "/dashboard/sessions/x%2Fy", "/dashboard/writing/x%5cy", "/dashboard/portfolio-other"])("does not broaden legacy matches: %s", path => {
    expect(canonicalSpacePath(path)).toBeNull();
  });

  it.each(["/dashboard/community/dm", "/dashboard/community/dm/a/b", "/dashboard/mentoring/conversations", "/dashboard/community/mentors/x", "/dashboard/me/certificates", "/dashboard/account/security"])("does not invent unshipped pages: %s", path => {
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

describe("channel pages (B-2.2)", () => {
  it.each([
    ["/dashboard/cohort/c/cohort-04", { space: "cohort", slug: "cohort-04" }],
    ["/dashboard/cohort/c/c04-announcements/", { space: "cohort", slug: "c04-announcements" }],
    ["/dashboard/community/c/help", { space: "community", slug: "help" }],
    ["/dashboard/community/c/a--b", { space: "community", slug: "a--b" }],
    ["/dashboard/community/c/" + "a".repeat(80), { space: "community", slug: "a".repeat(80) }],
  ])("serves %s as a channel route", (path, route) => {
    expect(channelRoute(path)).toEqual(route);
    expect(isChannelPagePath(path)).toBe(true);
    expect(isAvailableSpacePath(path)).toBe(true);
    expect(isNewSpacePath(path)).toBe(true);
    expect(canonicalSpacePath(path)).toBeNull();
    expect(legacySpacePath(path)).toBe(path.replace(/\/$/, ""));
    expect(spaceForPath(path)).toBe(route.space);
  });

  it("serves the code of conduct in the Community space", () => {
    for (const path of [CONDUCT_PATH, CONDUCT_PATH + "/"]) {
      expect(isChannelPagePath(path)).toBe(true);
      expect(isAvailableSpacePath(path)).toBe(true);
      expect(channelRoute(path)).toBeNull();
      expect(spaceForPath(path)).toBe("community");
    }
  });

  it.each([
    "/dashboard/community/c", "/dashboard/community/c/", "/dashboard/community/c/Help", "/dashboard/community/c/help-",
    "/dashboard/community/c/-help", "/dashboard/community/c/he_lp", "/dashboard/community/c/help/x",
    "/dashboard/community/c/%68elp", "/dashboard/community/c/help%2f..", "/dashboard/community/c/" + "a".repeat(81),
    "/dashboard/mentoring/c/help", "/dashboard/me/c/help", "/dashboard/community/conduct/x", "/dashboard/community/conducts",
    "/dashboard/cohort/conduct", "/dashboard/c/help",
  ])("does not serve %s", path => {
    expect(channelRoute(path)).toBeNull();
    expect(isChannelPagePath(path)).toBe(false);
    expect(isAvailableSpacePath(path)).toBe(false);
  });
});


describe("conversation and mentor pages (B-4.1)", () => {
  it.each(["/dashboard/community/dm/conversation-1", "/dashboard/community/dm/abc_DEF-9/", "/dashboard/community/dm/" + "a".repeat(255)])(
    "serves %s as a conversation in Community", (path) => {
      const id = path.replace(/\/$/, "").split("/").at(-1);
      expect(conversationRoute(path)).toEqual({ id });
      expect(channelRoute(path)).toBeNull();
      expect(isChannelPagePath(path)).toBe(true);
      expect(isAvailableSpacePath(path)).toBe(true);
      expect(isNewSpacePath(path)).toBe(true);
      expect(spaceForPath(path)).toBe("community");
    });

  it.each([
    "/dashboard/community/dm", "/dashboard/community/dm/", "/dashboard/community/dm/a/b", "/dashboard/community/dm/a%2fb",
    "/dashboard/community/dm/a.b", "/dashboard/community/dm/" + "a".repeat(256), "/dashboard/cohort/dm/a", "/dashboard/community/dms/a",
  ])("does not serve %s as a conversation", (path) => {
    expect(conversationRoute(path)).toBeNull();
    expect(isChannelPagePath(path)).toBe(false);
  });

  it("links each kind of channel to its own page", () => {
    expect(channelPagePath({ id: "c1", kind: "COHORT", slug: "cohort-04" })).toBe("/dashboard/cohort/c/cohort-04");
    expect(channelPagePath({ id: "c2", kind: "COMMUNITY", slug: "help" })).toBe("/dashboard/community/c/help");
    expect(channelPagePath({ id: "c 3", kind: "DIRECT", slug: "conversation" })).toBe("/dashboard/community/dm/c%203");
  });

  it("serves the directory in Community and requests and availability in Mentoring, and nothing near them", () => {
    expect(spaceForPath(MENTOR_PAGE_PATHS.directory)).toBe("community");
    expect(spaceForPath(MENTOR_PAGE_PATHS.requests)).toBe("mentoring");
    expect(spaceForPath(MENTOR_PAGE_PATHS.availability)).toBe("mentoring");
    for (const path of Object.values(MENTOR_PAGE_PATHS)) {
      for (const variant of [path, `${path}/`]) {
        expect(isMentorPagePath(variant)).toBe(true);
        expect(isAvailableSpacePath(variant)).toBe(true);
        expect(isChannelPagePath(variant)).toBe(false);
      }
      expect(isMentorPagePath(`${path}/x`)).toBe(false);
      expect(isAvailableSpacePath(`${path}-x`)).toBe(false);
    }
  });
});
