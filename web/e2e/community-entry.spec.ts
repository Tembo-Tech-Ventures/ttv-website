import { expect, test } from "@playwright/test";

test("public community entry explains membership and retains both sign-in destinations", async ({ page, baseURL }) => {
  test.skip(baseURL !== "http://127.0.0.1:4322", "Local component preview; deployed route coverage is separate.");
  await page.goto("/community-entry.html");
  await expect(page.getByRole("heading", { level: 1 })).toContainText("People, with the work");
  await expect(page.getByText("You do not need to join or complete a cohort", { exact: false })).toBeVisible();
  await expect(page.getByRole("link", { name: "Join the community" })).toHaveAttribute("href", "/auth/login?next=%2Fdashboard%2Fcommunity");
  await expect(page.getByRole("link", { name: "Continue to institutional access" })).toHaveAttribute("href", "/auth/login?next=%2Fdashboard%2Fdiscover");
  await expect(page.getByText("Institutional access requires administrator approval after sign-in.", { exact: false })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: `test-results/community-entry-${test.info().project.name}.png`, fullPage: true });
});
