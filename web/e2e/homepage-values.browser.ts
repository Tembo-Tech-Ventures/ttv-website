import { test, expect } from "@playwright/test";
import { assertHomepageValues } from "./homepage-values-assertions";

for (const width of [320, 390, 768, 1440, 2560]) {
  test(`homepage is readable with working destinations at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    await page.goto("/homepage-values.html");
    await page.evaluate(() => document.fonts.ready);
    await assertHomepageValues(page);
    const wordmark = page.locator("h1");
    await expect(wordmark).toHaveAccessibleName("Great builders. Already here.");
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
  await expect.poll(() => member.locator(".home-arrow").evaluate((el) => getComputedStyle(el).transform)).toBe("matrix(0.707107, 0.707107, -0.707107, 0.707107, 0, 0)");
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
  await expect(page.locator("html")).not.toHaveClass(/home-motion-wait/);
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

test("hero type settles and stays within its container", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto("/homepage-values.html");
  const line = page.locator(".home-wordmark-line > span").first();
  await expect.poll(() => line.evaluate((el) => el.getAnimations().some((animation) => animation.playState === "running"))).toBe(true);
  const during = await line.evaluate((el) => getComputedStyle(el).transform);
  await expect.poll(() => line.evaluate((el) => getComputedStyle(el).transform)).not.toBe(during);
  await expect.poll(() => line.evaluate((el) => el.getAnimations().every((animation) => animation.playState === "finished"))).toBe(true);
  expect(await line.evaluate((el) => el.scrollWidth <= el.clientWidth + 1)).toBe(true);
});

test("mobile action precedes the illustration and remains in the first viewport", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/homepage-values.html");
  const action = (await page.getByRole("link", { name: "Join the community" }).boundingBox())!;
  expect(action.y + action.height).toBeLessThan(700);
  expect((await page.locator(".home-evidence").boundingBox())!.y).toBeGreaterThan(action.y);
});

test("audience hover and keyboard focus highlight the corresponding fictional evidence", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto("/homepage-values.html");
  const story = page.locator(".home-story");
  for (const stage of ["contribution", "mentor", "question"]) {
    const link = page.locator(`[data-home-stage="${stage}"]`);
    await link.hover();
    await expect(story).toHaveAttribute("data-active-stage", stage);
    await expect.poll(() => page.locator(`[data-evidence-stage="${stage}"]`).evaluate((el) => getComputedStyle(el).backgroundColor)).toBe("rgb(245, 212, 188)");
    await page.mouse.move(0, 0);
    await expect(story).toHaveAttribute("data-active-stage", "");
    await link.focus();
    await expect(story).toHaveAttribute("data-active-stage", stage);
    await page.getByRole("link", { name: "How it works", exact: true }).focus();
  }
  await expect(page.getByText("Fictional illustration", { exact: true })).toBeVisible();
});

test("scroll reveals run and live reduced-motion changes cancel movement", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 700 });
  await page.goto("/homepage-values.html");
  const row = page.locator("[data-evidence-stage=question]");
  await row.scrollIntoViewIfNeeded();
  await expect.poll(() => row.evaluate((el) => el.getAnimations({ subtree: true }).some((animation) => animation.playState === "running"))).toBe(true);
  await page.emulateMedia({ reducedMotion: "reduce" });
  await expect.poll(() => row.evaluate((el) => el.getAnimations({ subtree: true }).length)).toBe(0);
  await expect(row).toBeVisible();
  expect(await page.locator(".home-evidence-thread").evaluate((el) => el.getAnimations({ subtree: true }).length)).toBe(0);
});

test("evidence segments draw once alongside their arriving context", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 700 });
  await page.goto("/homepage-values.html");
  const mentor = page.locator('[data-evidence-stage="mentor"]');
  const stem = page.locator(".home-evidence-stem").first();
  await mentor.scrollIntoViewIfNeeded();
  await expect.poll(() => stem.evaluate((el) => el.getAnimations().some((animation) => animation.playState === "running"))).toBe(true);
  const during = await stem.evaluate((el) => getComputedStyle(el).transform);
  await expect.poll(() => stem.evaluate((el) => getComputedStyle(el).transform)).not.toBe(during);
  await expect.poll(() => stem.evaluate((el) => el.getAnimations().length)).toBe(0);
  expect(await stem.evaluate((el) => new DOMMatrixReadOnly(getComputedStyle(el).transform).d)).toBe(1);
  await page.evaluate(() => scrollTo(0, 0));
  await mentor.scrollIntoViewIfNeeded();
  expect(await stem.evaluate((el) => el.getAnimations().length)).toBe(0);
});

test("unsupported intersection observer leaves all content and navigation usable", async ({ page }) => {
  await page.addInitScript(() => { Reflect.deleteProperty(window, "IntersectionObserver"); });
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto("/homepage-values.html");
  await assertHomepageValues(page);
  expect(errors).toEqual([]);
});

test("unresponsive font loading cannot leave the entrance paused", async ({ page }) => {
  await page.addInitScript(() => { document.fonts.load = () => new Promise(() => {}); });
  await page.goto("/homepage-values.html");
  const line = page.locator(".home-wordmark-line > span").first();
  await expect.poll(() => line.evaluate((el) => el.getAnimations().every((animation) => animation.playState === "finished")), { timeout: 2500 }).toBe(true);
  await expect(page.getByRole("link", { name: "Join the community" })).toBeVisible();
});

test("footer brand has balanced complete lines at desktop and mobile", async ({ page }) => {
  for (const width of [320, 390, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    await page.goto("/homepage-values.html");
    await page.evaluate(() => document.fonts.ready);
    const lines = page.locator(".home-footer-lockup span");
    await expect(lines).toHaveText(["TEMBO", "TECH VENTURES"]);
    const sizes = await lines.evaluateAll((elements) => elements.map((el) => parseFloat(getComputedStyle(el).fontSize)));
    expect(sizes[0] / sizes[1]).toBeLessThan(3);
    for (const line of await lines.all()) {
      expect(await line.evaluate((el) => el.scrollWidth <= el.clientWidth + 1)).toBe(true);
    }
  }
});

test("200 percent mobile text does not clip masked headline words", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/homepage-values.html");
  await page.evaluate(() => { document.documentElement.style.fontSize = "200%"; });
  for (const line of await page.locator(".home-wordmark-line > span").all()) {
    expect(await line.evaluate((el) => el.scrollWidth <= el.clientWidth + 1)).toBe(true);
  }
  await assertHomepageValues(page);
});

test("mobile illustration precedes its audience links and headline has four deliberate lines", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/homepage-values.html");
  const figure = (await page.locator(".home-evidence").boundingBox())!;
  const pathways = (await page.locator(".home-pathways").boundingBox())!;
  expect(figure.y + figure.height).toBeLessThan(pathways.y);
  const lines = await page.locator(".home-title-word").evaluateAll((elements) => elements.map((el) => el.getBoundingClientRect().top));
  expect(new Set(lines).size).toBe(4);
});

test("content already visible at startup never dims when the observer attaches", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1500 });
  await page.goto("/homepage-values.html");
  const intro = page.locator(".home-section-intro");
  await expect(intro).toBeInViewport();
  expect(await intro.evaluate((el) => el.getAnimations().length)).toBe(0);
  expect(await intro.evaluate((el) => getComputedStyle(el).opacity)).toBe("1");
});
