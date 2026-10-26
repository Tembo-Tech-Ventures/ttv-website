import { expect, type Page } from "@playwright/test";
import { VALUES } from "../src/components/homepage/values";

/** The same assertions run against server markup locally and the deployed homepage. */
export async function assertHomepageValues(page: Page) {
  const intro = page.locator(".home-introduction");
  await expect(intro.getByRole("heading", { level: 1 })).toHaveAccessibleName("Great builders. Already here.");
  await expect(intro.getByRole("region", { name: "Our values" })).toHaveCount(0);
  await expect(intro).not.toContainText("§");
  const rows = intro.locator(".value-commitment-row");
  await expect(rows).toHaveCount(VALUES.length);
  for (const [index, value] of VALUES.entries()) {
    const row = rows.nth(index);
    await row.scrollIntoViewIfNeeded();
    await expect(row.locator(".value-word")).toHaveText(value.word);
    await expect(row.locator(".value-commitment-copy")).toHaveText(value.commitment);
    await expect(intro.getByText(value.commitment, { exact: true })).toHaveCount(1);
    expect(await row.evaluate((el) => {
      const bounds = el.getBoundingClientRect();
      return [".value-word", ".value-commitment-copy"].every((selector) => {
        const child = el.querySelector(selector)!;
        const box = child.getBoundingClientRect();
        return box.width > 0 && box.height > 0 && box.left >= bounds.left - 1 && box.right <= bounds.right + 1 && child.scrollWidth <= child.clientWidth + 1;
      });
    }), `${value.word} and its commitment fit`).toBe(true);
  }
  for (const audience of ["members", "mentors", "institutions"]) {
    await expect(intro.locator(`a[href="/community/${audience}"]`)).toHaveCount(1);
  }
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
}
