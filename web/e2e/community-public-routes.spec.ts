import { expect, test } from "@playwright/test";
import { FIXTURE_ENVIRONMENT } from "./fixture-env";
import { guardFeedbackBrowserContext, closeFeedbackBrowserContext } from "../scripts/cloudflare/feedback-browser-guard.mjs";

test("public navigation leads to community and preserves sign-in return paths", async ({ page, baseURL }) => {
  test.skip(baseURL === "http://127.0.0.1:4322", "Requires actual Astro routes, not the component harness.");
  await page.goto("/");
  const menu = page.getByRole("button", { name: "Open menu" });
  if (await menu.isVisible()) await menu.click();
  const navigation = page.locator("header a[href='/community']:visible");
  await expect(navigation).toHaveCount(1);
  await navigation.click();
  await expect(page).toHaveURL(/\/community$/);
  await expect(page.getByRole("heading", { level: 1 })).toContainText("People, with the work");
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.getByRole("link", { name: "Join the community" }).click();
  await expect(page).toHaveURL(/\/auth\/login\?next=%2Fdashboard%2Fcommunity$/);
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Sign in to Tembo.");
  await page.goto("/community");
  await page.getByRole("link", { name: "Continue to institutional access" }).click();
  await expect(page).toHaveURL(/\/auth\/login\?next=%2Fdashboard%2Fdiscover$/);
});

test("existing builder and hiring pages explain the wider community", async ({ page, baseURL }) => {
  test.skip(baseURL === "http://127.0.0.1:4322", "Requires actual Astro routes.");
  await page.goto("/talent");
  await expect(page.getByRole("link", { name: "Build your community profile" })).toHaveAttribute("href", "/community");
  await page.goto("/hire");
  await expect(page.getByRole("link", { name: "Learn about institutional access" })).toHaveAttribute("href", "/community#institutions");
});

for (const [audience, headline, cta, destination] of [
  ["members", "Give your work a story.", "Build your community profile", "/dashboard/community"],
  ["mentors", "Make the contribution clearer.", "Continue to mentor review", "/dashboard/mentorship"],
  ["institutions", "Look beyond the profile. Understand the work.", "Continue to institutional access", "/dashboard/discover"],
]) {
  test(`public ${audience} journey reaches GitHub sign-in with the intended return path`, async ({ page, baseURL }) => {
    test.skip(baseURL === "http://127.0.0.1:4322", "Requires actual Astro routes, not the component harness.");
    await page.goto("/community");
    await page.getByRole("navigation", { name: "Community participation" }).getByRole("link", { name: `For ${audience}` }).click();
    await expect(page).toHaveURL(new RegExp(`/community/${audience}$`));
    await expect(page.getByRole("heading", { level: 1 })).toHaveText(headline);
    await expect(page.locator('link[rel="canonical"]')).toHaveAttribute("href", new RegExp(`/community/${audience}$`));
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.getByRole("link", { name: cta }).first().click();
    await expect(page).toHaveURL(new URL(`/auth/login?next=${encodeURIComponent(destination)}`, baseURL!).href);
    await expect(page.getByRole("heading", { name: "Sign in to Tembo." })).toBeVisible();
  });
}

test("isolated preview ADMIN audience CTAs reach their actual workspaces", async ({ browser, baseURL }, testInfo) => {
  const token = process.env.PLAYWRIGHT_AGENT_TOKEN;
  test.skip(!FIXTURE_ENVIRONMENT || !token, "Requires the isolated preview seeded ADMIN session; non-admin role verification is separate.");
  const context = await browser.newContext({ baseURL, extraHTTPHeaders: { Authorization: `Bearer ${token}` }, viewport: testInfo.project.use.viewport });
  try {
    await guardFeedbackBrowserContext(context, baseURL!);
    // agent-preview-auth.mjs seeds this Better Auth session with ADMIN.
    // Community APIs require scoped PATs; this browser-only check must not use
    // the session bearer as a PAT. PR191's cookie personas cover non-admin roles.
    const page = await context.newPage();
    for (const entry of [
      { audience: "members", cta: "Open my community journey", destination: "/dashboard/community", heading: "Your work. Your story." },
      { audience: "mentors", cta: "Continue to mentor review", destination: "/dashboard/mentorship", heading: "Recognise the work. Name what you saw." },
      { audience: "institutions", cta: "Continue to institutional access", destination: "/dashboard/discover", heading: "Find the person. See the work." },
    ]) {
      await page.goto(`/community/${entry.audience}`);
      await page.getByRole("link", { name: entry.cta }).first().click();
      await expect(page).toHaveURL(new URL(entry.destination, baseURL!).href);
      await expect(page.locator(".discovery-app").getByRole("heading", { level: 1 })).toHaveText(entry.heading);
    }
  } finally {
    await closeFeedbackBrowserContext(context);
  }
});
