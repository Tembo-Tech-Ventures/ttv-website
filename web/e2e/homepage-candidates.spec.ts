import { expect, test } from "@playwright/test";
import { VALUES } from "../src/components/homepage/values";
import { SECTION_ORDER } from "../src/lib/homepage/content";
import { installTextTracker, textReport, walkAndSample } from "./text-integrity";

/**
 * Contract for every homepage design candidate: the same sections in the same
 * order, the five principles all present, and not one word that a visitor
 * cannot read at some point while scrolling — at phone and desktop sizes, with
 * and without reduced motion. Static content only, so it runs against local
 * dev servers and deployed previews alike.
 */
const CANDIDATES = ["/preview/home/a", "/preview/home/b", "/preview/home/c"];

for (const path of CANDIDATES) {
  test.describe(path, () => {
    test.setTimeout(240_000);

    test("keeps the agreed section order and all five principles", async ({ page }) => {
      await page.goto(path);
      const tops: number[] = [];
      for (const id of SECTION_ORDER) {
        const section = page.locator(`main #${id}`);
        await expect(section, `#${id} is missing`).toHaveCount(1);
        tops.push(await section.evaluate((el) => el.getBoundingClientRect().top + window.scrollY));
      }
      expect(tops).toEqual(tops.toSorted((a, b) => a - b));
      const principles = page.locator("main #principles");
      for (const value of VALUES) {
        await expect(principles.getByText(value.word, { exact: true }).first()).toBeAttached();
        await expect(principles.getByText(value.commitment, { exact: true }).first()).toBeAttached();
      }
      await expect(page.locator("main h1")).toHaveCount(1);
    });

    for (const reducedMotion of ["no-preference", "reduce"] as const) {
      test(`every word is readable while scrolling (motion: ${reducedMotion})`, async ({ page }) => {
        const errors: string[] = [];
        page.on("pageerror", (error) => errors.push(error.message));
        await page.emulateMedia({ reducedMotion });
        await page.goto(path);
        await page.evaluate(() => document.fonts.ready);
        await page.waitForTimeout(1200);
        await installTextTracker(page, "main");
        await walkAndSample(page);
        const report = await textReport(page);
        const unreadable = report.issues.filter((issue) => !issue.decorative);
        expect(unreadable, JSON.stringify(unreadable, null, 2)).toEqual([]);
        expect(report.maxHorizontalOverflow).toBeLessThanOrEqual(1);
        expect(errors).toEqual([]);
      });
    }
  });
}
