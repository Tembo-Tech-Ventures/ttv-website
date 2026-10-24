import { expect, test } from "@playwright/test";

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
