import { expect, test } from "@playwright/test";
import { FIXTURE_ENVIRONMENT } from "./fixture-env";
import { spaceRouteRequest } from "../scripts/cloudflare/space-route-browser-guard.mjs";

const entries: Record<string, string> = {
  cohort: "/dashboard/cohort", community: "/dashboard/community",
  mentoring: "/dashboard/mentoring", discover: "/dashboard/discover",
  admin: "/admin", profile: "/dashboard/me",
};

test.describe("space routes without JavaScript", () => {
  const token = process.env.PLAYWRIGHT_AGENT_TOKEN;
  test.skip(!token, "An authenticated delivery identity is required.");
  test.use({ javaScriptEnabled: false, extraHTTPHeaders: token ? { Authorization: `Bearer ${token}` } : {} });

  test("legacy links redirect only when enabled and resolve to existing pages", async ({ request, page, baseURL }) => {
    const meResponse = await spaceRouteRequest(request, baseURL!, "/api/platform/me");
    if (meResponse.status() === 404) {
      expect((await spaceRouteRequest(request, baseURL!, "/dashboard/profile")).status()).toBe(200);
      expect((await spaceRouteRequest(request, baseURL!, "/dashboard/account")).status()).toBe(404);
      return;
    }
    expect(meResponse.status()).toBe(200);
    const me = await meResponse.json() as { spaces: string[] };
    const redirects = [
      ["apply", "cohort/apply", "profile"],
      ["sessions", "cohort/sessions", "cohort"],
      ["ask", "cohort/ask", "cohort"],
      ["mentorship", "mentoring/confirm", "mentoring"],
      ["portfolio", "me/portfolio", "profile"],
      ["writing", "me/writing", "profile"],
      ["opportunities", "me/opportunities", "profile"],
      ["leads", "me/leads", "profile"],
      ["profile", "account", "profile"],
    ];
    for (const [legacy, canonical, space] of redirects) {
      const response = await spaceRouteRequest(request, baseURL!, `/dashboard/${legacy}?route-check=1`);
      if (!me.spaces.includes(space!)) {
        expect(response.status()).toBe(403);
        continue;
      }
      expect(response.status()).toBe(301);
      expect(response.headers().location).toBe(`/dashboard/${canonical}?route-check=1`);
      expect(response.headers()["cache-control"]).toBe("no-store");
      const rendered = await page.goto(`/dashboard/${canonical}`);
      expect(rendered?.status()).toBe(200);
    }
  });

  test("server preference and explicit URLs work without hydration", async ({ page, request, context, baseURL }) => {
    const meResponse = await spaceRouteRequest(request, baseURL!, "/api/platform/me");
    test.skip(meResponse.status() === 404, "Spaces is OFF for this caller.");
    expect(meResponse.status()).toBe(200);
    const me = await meResponse.json() as { spaces: string[] };
    await page.goto("/dashboard/community");
    await page.goto("/dashboard");
    await expect(page).toHaveURL(new URL("/dashboard/community", baseURL!).href);
    await page.goto("/dashboard/me");
    await expect(page).toHaveURL(new URL("/dashboard/me", baseURL!).href);
    await page.goto("/dashboard");
    await expect(page).toHaveURL(new URL("/dashboard/me", baseURL!).href);
    const preference = (await context.cookies()).find(cookie => cookie.name === "ttv-last-space");
    expect(preference).toMatchObject({ value: "profile", path: "/dashboard", httpOnly: false, sameSite: "Lax" });
    await context.addCookies([{ name: "ttv-last-space", value: "invalid-space", domain: new URL(baseURL!).hostname,
      path: "/dashboard", secure: new URL(baseURL!).protocol === "https:", sameSite: "Lax" }]);
    await page.goto("/dashboard");
    await expect(page).toHaveURL(new URL(entries[me.spaces[0]!]!, baseURL!).href);
  });

  test("canonical account form retains its POST body through the rewrite", async ({ request, baseURL }) => {
    test.skip(!FIXTURE_ENVIRONMENT, "Form checks run only against isolated synthetic previews.");
    const meResponse = await spaceRouteRequest(request, baseURL!, "/api/platform/me");
    test.skip(meResponse.status() === 404, "Spaces is OFF for this caller.");
    expect(meResponse.status()).toBe(200);
    const response = await spaceRouteRequest(request, baseURL!, "/dashboard/account", {
      method: "POST", form: { action: "avatar" }, headers: { Origin: new URL(baseURL!).origin },
    });
    // The avatar action with no file proves the body arrived without writing data.
    expect(response.status()).toBe(200);
    expect(await response.text()).toContain("Please choose an image to upload.");
    expect(response.headers().location).toBeUndefined();
  });
});
