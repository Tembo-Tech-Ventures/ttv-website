import { test, expect } from "@playwright/test";
for (const width of [390, 1440]) {
  test(`organizer overview: readable, local assets and working TOC at ${width}`, async ({
    page,
  }) => {
    const errors: string[] = [];
    page.on("pageerror", (err) => errors.push(err.message));
    await page.setViewportSize({ width, height: 1000 });
    await page.goto("/organizer.html");
    await expect(page.getByRole("heading", { level: 1 })).toHaveText(
      "Show whatyou can do.",
    );
    const nav = page.getByRole("navigation", { name: "On this page" });
    await expect(nav.getByRole("link")).toHaveCount(6);
    for (const link of await nav.getByRole("link").all()) {
      const href = await link.getAttribute("href");
      await link.click();
      await expect(page.locator(href!)).toBeVisible();
    }
    for (const image of await page.getByRole("img").all()) {
      await image.scrollIntoViewIfNeeded();
      await expect
        .poll(() =>
          image.evaluate((el) => (el as HTMLImageElement).naturalWidth),
        )
        .toBeGreaterThan(0);
    }
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
    await expect(page.locator("form,input,textarea")).toHaveCount(0);
    await page.goto("/organizer.html");
    await page.keyboard.press("Tab");
    await expect(
      page.getByRole("link", { name: "Skip to the project story" }),
    ).toBeFocused();
    await page.keyboard.press("Enter");
    await expect(page).toHaveURL(/#hack-content$/);
    await page.evaluate(() => window.scrollTo(0, 0));
    await page.screenshot({
      path: `../docs/hackathon/organizer-2026-10-25/overview-${width}.png`,
      fullPage: true,
    });
    await page.screenshot({path:`../docs/hackathon/organizer-2026-10-25/hero-${width}.png`});
    await page.locator('#architecture').screenshot({path:`../docs/hackathon/organizer-2026-10-25/architecture-${width}.png`});
    const region=page.getByRole('region', {name:'Web and MCP use shared authorized services, D1 and optional model routes'});
    await region.focus();
    if(width === 390) {
      await page.keyboard.press('ArrowRight');
      await expect.poll(()=>region.evaluate(el=>el.scrollLeft)).toBeGreaterThan(0);
    }
    expect(errors).toEqual([]);
  });
}
