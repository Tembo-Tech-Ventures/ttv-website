import { test, expect } from "@playwright/test";
import { VALUES } from "../src/components/homepage/values";

for (const width of [280, 390, 1440, 3440]) {
  test(`all words and descriptions fit at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 1000 });
    await page.goto("/homepage-values.html");
    await page.evaluate(() => document.fonts.ready);
    const carousel = page.getByRole("region", { name: "Our values" });
    for (const value of VALUES) {
      await expect(carousel.locator(".value-word")).toHaveText(value.word);
      await expect(carousel.locator(".values-bubble p")).toHaveText(value.commitment);
      await expect.poll(() => page.locator(".value-word").evaluateAll((words) => words.every((word) => {
        const text = word.getBoundingClientRect();
        const container = word.parentElement!.getBoundingClientRect();
        return text.left >= container.left && text.right <= container.right + 1;
      }))).toBe(true);
      const word = await carousel.locator(".value-word").boundingBox();
      const bubble = await carousel.locator(".values-bubble").boundingBox();
      expect(bubble!.y).toBeGreaterThanOrEqual(word!.y + word!.height);
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
      await carousel.getByRole("button", { name: "Next value" }).click();
    }
    await expect(carousel.locator(".value-word")).toHaveText("COMMUNITY");
    await carousel.getByRole("button", { name: "Previous value" }).click();
    await expect(carousel.locator(".value-word")).toHaveText("HONESTY");
    await carousel.getByRole("button", { name: "Next value" }).click();
    await carousel.getByRole("button", { name: "Next value" }).click();
    await expect(carousel.locator(".value-word")).toHaveText("PHILOSOPHY");
    await page.locator("#what-we-do").screenshot({ animations: "disabled", path: `../docs/hackathon/homepage-values-2026-10-25/width-${width}.png` });
  });
}

test("keyboard navigation retains focus; reduced motion and enlarged text remain readable", async ({ page }) => {
  await page.setViewportSize({ width: 720, height: 1000 });
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/homepage-values.html");
  // 720 CSS pixels represents the layout viewport of a 1440px desktop at 200% zoom.
  // Also enlarge root text independently to cover text-only enlargement.
  await page.evaluate(() => { document.documentElement.style.fontSize = "200%"; });
  await page.evaluate(() => document.fonts.ready);
  const carousel = page.getByRole("region", { name: "Our values" });
  const next = carousel.getByRole("button", { name: "Next value" });
  await next.focus();
  await page.keyboard.press("ArrowRight");
  await expect(carousel.locator(".value-word")).toHaveText("PHILOSOPHY");
  await expect(next).toBeFocused();
  await page.keyboard.press("End");
  await expect(carousel.locator(".value-word")).toHaveText("HONESTY");
  await page.keyboard.press("Home");
  await expect(carousel.locator(".value-word")).toHaveText("COMMUNITY");
  await page.keyboard.press("ArrowLeft");
  await expect(carousel.locator(".value-word")).toHaveText("HONESTY");
  expect(await carousel.locator(".values-bubble").evaluate((el) => getComputedStyle(el).animationName)).toBe("none");
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await expect(next).toBeFocused();
  await page.keyboard.press("Tab");
  await page.keyboard.press("Enter");
  await expect(page.getByText("Accountability over assignments.", { exact: false })).toBeVisible();
  await page.locator("#what-we-do").screenshot({ animations: "disabled", path: "../docs/hackathon/homepage-values-2026-10-25/enlarged-text.png" });
});

test("fits again after viewport resize without layout oscillation", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto("/homepage-values.html");
  await page.evaluate(() => document.fonts.ready);
  await page.setViewportSize({ width: 320, height: 800 });
  await expect.poll(() => page.locator(".value-word").evaluateAll((words) => words.every((word) => word.getBoundingClientRect().right <= word.parentElement!.getBoundingClientRect().right + 1))).toBe(true);
  const next = page.getByRole("button", { name: "Next value" });
  await next.click();
  await expect(page.locator(".values-carousel .value-word")).toHaveText("PHILOSOPHY");
  // Playwright's clickability check also requires a stable bounding box.
  await next.click();
  await expect(page.locator(".values-carousel .value-word")).toHaveText("EQUITY");
  expect(errors).toEqual([]);
});
