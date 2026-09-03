import { expect, test, type Page, type TestInfo } from "@playwright/test";

/**
 * The app chrome stays where it is while the page scrolls.
 *
 * Runs against `/dev/shell-preview`, which renders the real `AdminShell` with
 * filler content — the authenticated admin pages are not reachable from a local
 * dev server, and the layout is identical.
 *
 * Before this, neither the sidebar nor the header was positioned: both were
 * ordinary flex children of a `min-h-screen` row, so scrolling any long admin
 * page took the entire navigation with it.
 */
test.skip(
  Boolean(process.env.PLAYWRIGHT_BASE_URL),
  "The shell preview is dev-only and intentionally unavailable on deployed environments."
);

const SCROLL_TO = 2_000;

async function gotoShell(page: Page) {
  await page.goto("/dev/shell-preview");
  await expect(page.locator("astro-island")).not.toHaveAttribute("ssr", /.*/);
}

function isMobile(testInfo: TestInfo) {
  return testInfo.project.name.includes("mobile");
}

test("the mobile header stays visible after scrolling", async ({ page }, testInfo) => {
  test.skip(!isMobile(testInfo), "The header is mobile-only; desktop uses the sidebar");

  await gotoShell(page);
  const header = page.locator("header").first();
  await expect(header).toBeInViewport();

  await page.evaluate((y) => window.scrollTo(0, y), SCROLL_TO);
  await expect.poll(() => page.evaluate(() => window.scrollY)).toBeGreaterThan(0);

  await expect(header).toBeInViewport();
  const top = await header.evaluate((element) => element.getBoundingClientRect().top);
  expect(Math.round(top)).toBeLessThanOrEqual(1);
});

test("the desktop sidebar nav stays visible after scrolling", async ({ page }, testInfo) => {
  test.skip(isMobile(testInfo), "The sidebar is a drawer on mobile, not persistent chrome");

  await gotoShell(page);
  // A link near the bottom of the nav, so this fails if the aside merely
  // stretches rather than sticks.
  const navLink = page.getByRole("link", { name: "Users" }).first();
  await expect(navLink).toBeInViewport();

  await page.evaluate((y) => window.scrollTo(0, y), SCROLL_TO);
  await expect.poll(() => page.evaluate(() => window.scrollY)).toBeGreaterThan(0);

  await expect(navLink).toBeInViewport();
});

test("the sidebar scrolls its own overflow rather than the page", async ({ page }, testInfo) => {
  test.skip(isMobile(testInfo), "Desktop-only chrome");

  await gotoShell(page);
  const overflow = await page.locator("aside").evaluate((element) => ({
    scrolls: getComputedStyle(element).overflowY,
    // `align-self: stretch` would make it as tall as the page, and an element
    // as tall as its container can never stick.
    height: Math.round(element.getBoundingClientRect().height),
    viewport: window.innerHeight,
  }));

  expect(overflow.scrolls).toBe("auto");
  expect(overflow.height).toBeLessThanOrEqual(overflow.viewport + 1);
});

test("exactly one h1 is exposed at every width", async ({ page }) => {
  /*
   * The header used to own the h1 unconditionally. Now it is mobile-only and
   * the sidebar owns it on desktop. Both are always in the DOM — which is which
   * is a CSS-visibility decision — so this counts what the accessibility tree
   * exposes, not what `document.querySelectorAll` finds.
   */
  await gotoShell(page);
  await expect(page.getByRole("heading", { level: 1 })).toHaveCount(1);
});

test("the page still scrolls, and content is not trapped", async ({ page }) => {
  await gotoShell(page);
  await expect(page.locator("[data-filler-row='60']")).toBeAttached();

  await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
  await expect(page.locator("[data-filler-row='60']")).toBeInViewport();
});
