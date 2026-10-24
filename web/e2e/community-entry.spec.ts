import { expect, test } from "@playwright/test";

test("public community entry explains membership and retains both sign-in destinations", async ({ page, baseURL }) => {
  test.skip(baseURL !== "http://127.0.0.1:4322", "Local component preview; deployed route coverage is separate.");
  await page.goto("/community-entry.html");
  await expect(page.getByRole("heading", { level: 1 })).toContainText("People, with the work");
  await expect(page.getByText("You do not need to join or complete a cohort", { exact: false })).toBeVisible();
  await expect(page.getByRole("link", { name: "Join the community" })).toHaveAttribute("href", "/auth/login?next=%2Fdashboard%2Fcommunity");
  await expect(page.getByRole("link", { name: "Continue to institutional access" })).toHaveAttribute("href", "/auth/login?next=%2Fdashboard%2Fdiscover");
  await expect(page.getByText("Signing in does not grant institutional access.", { exact: false })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: `test-results/community-entry-${test.info().project.name}.png`, fullPage: true });
});

test("a member without cohort access can reach their journey from dashboard navigation and context", async ({ page, baseURL }, testInfo) => {
  test.skip(baseURL !== "http://127.0.0.1:4322", "Local component preview; no live authentication.");
  await page.goto("/community-entry.html?dashboard");
  await expect(page.getByRole("link", { name: "Open my profile and journey" })).toHaveAttribute("href", "/dashboard/community");
  if (testInfo.project.name === "mobile") await page.getByRole("button", { name: "Open navigation" }).click();
  await expect(page.getByRole("link", { name: "Community", exact: true })).toBeVisible();
  await expect(page.getByRole("link", { name: "Community", exact: true })).toHaveAttribute("href", "/dashboard/community");
  await expect(page.getByRole("link", { name: "Sessions", exact: true })).toHaveCount(0);
  await expect(page.getByRole("link", { name: "Profile", exact: true })).toHaveCount(0);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});
