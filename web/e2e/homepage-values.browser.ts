import { test, expect } from "@playwright/test";
import { assertHomepageValues } from "./homepage-values-assertions";

for (const width of [320, 390, 768, 1440, 2560]) {
  test(`homepage is readable with working destinations at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    await page.goto("/homepage-values.html");
    await page.evaluate(() => document.fonts.ready);
    await assertHomepageValues(page);
    const wordmark = page.locator("h1");
    await expect(wordmark).toHaveText("TEMBO");
    expect(await wordmark.evaluate((el) => el.scrollWidth - el.clientWidth)).toBeLessThanOrEqual(1);
    for (const link of await page.locator(".home-pathway").all()) {
      expect((await link.boundingBox())!.height).toBeGreaterThanOrEqual(44);
    }
    const join = page.getByRole("link", { name: "Join the community" });
    await expect(join).toHaveAttribute("href", "/auth/login?next=%2Fdashboard%2Fcommunity");
    await page.getByRole("link", { name: "How it works" }).click();
    await expect(page).toHaveURL(/#what-we-do$/);
    await expect(page.locator("#home-how-heading")).toBeInViewport();
    await page.screenshot({ path: `test-results/homepage-${width}.png`, fullPage: true });
  });
}

test("keyboard focus and contextual link motion work without hydration", async ({ page }) => {
  await page.goto("/homepage-values.html");
  await page.keyboard.press("Tab");
  await expect(page.getByRole("link", { name: "Join the community" })).toBeFocused();
  const member = page.locator('a[href="/community/members"]');
  await member.focus();
  expect(await member.evaluate((el) => getComputedStyle(el).outlineStyle)).toBe("solid");
  await expect.poll(() => member.locator(".home-arrow").evaluate((el) => getComputedStyle(el).transform)).toBe("matrix(1, 0, 0, 1, 3, -3)");
  await page.keyboard.press("Enter");
  await expect(page).toHaveURL(/\/community\/members$/);
});

test("reduced motion removes entrance, scroll and hover animation; enlarged text fits", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.setViewportSize({ width: 720, height: 900 });
  await page.goto("/homepage-values.html");
  await page.evaluate(() => { document.documentElement.style.fontSize = "200%"; });
  await assertHomepageValues(page);
  expect(await page.locator("h1").evaluate((el) => getComputedStyle(el).animationName)).toBe("none");
  expect(await page.locator(".home-section").first().evaluate((el) => getComputedStyle(el, "::before").animationName)).toBe("none");
  const member = page.locator(".home-pathway").first();
  await member.hover();
  expect(await member.locator(".home-arrow").evaluate((el) => getComputedStyle(el).transform)).toBe("none");
  expect(await member.locator(".home-arrow").evaluate((el) => getComputedStyle(el).transitionDuration)).toBe("0s");
});

test("signed-in visitors have one direct journey action", async ({ page }) => {
  await page.goto("/homepage-values.html?signed-in");
  await expect(page.getByRole("link", { name: "Open my journey" })).toHaveAttribute("href", "/dashboard/community");
  await expect(page.locator('a[href*="/auth/login"]')).toHaveCount(0);
});

test("content and navigation survive disabled JavaScript", async ({ page }) => {
  await page.goto("/homepage-values.html");
  const html = await page.content();
  const context = await page.context().browser()!.newContext({ javaScriptEnabled: false });
  const staticPage = await context.newPage();
  // Replay real server markup and styles with all scripts disabled.
  await staticPage.route("https://homepage.test/", (route) => route.fulfill({ body: html.replace('<head>', '<head><base href="http://127.0.0.1:4322/">'), contentType: "text/html" }));
  await staticPage.goto("https://homepage.test/");
  await expect(staticPage.getByRole("link", { name: "Join the community" })).toBeVisible();
  await expect(staticPage.getByRole("heading", { name: "HONESTY", exact: true })).toBeVisible();
  await context.close();
});
