import { expect, test } from "@playwright/test";
import { assertHomepageValues } from "./homepage-values-assertions";

/**
 * Layout regressions that only a real browser can catch: content pushed out of
 * a box that hides its overflow, so it vanishes silently rather than breaking
 * anything a unit test would notice.
 *
 * These need no seeded fixtures — every page here renders from static content —
 * so they run against local dev servers and deployed previews alike.
 */

const TOLERANCE_PX = 1;

const expectedPublicLinks = [
  { label: "How", href: "/#what-we-do" },
  { label: "Why", href: "/#why-tembo" },
  { label: "Builders", href: "/talent" },
  { label: "Hire", href: "/hire" },
  { label: "Blog", href: "/blog" },
];

test.describe("layout integrity", () => {
  test("public navigation and footer expose the front-door links", async ({
    page,
    viewport,
  }) => {
    await page.goto("/");
    const header = page.locator("header");
    const isMobile = (viewport?.width ?? 1280) < 1024;

    if (isMobile) {
      await header.getByRole("button", { name: "Open menu" }).click();
    }

    for (const link of expectedPublicLinks) {
      await expect(
        header.getByRole("link", { name: link.label, exact: true })
      ).toHaveAttribute("href", link.href);
    }
    await expect(
      header.getByRole("link", { name: "Sign in", exact: true })
    ).toHaveAttribute("href", "/auth/login");
    await expect(
      header.getByRole("link", { name: "Apply", exact: true })
    ).toHaveAttribute("href", "/dashboard/apply");

    const footer = page.locator("footer");
    await footer.scrollIntoViewIfNeeded();
    for (const link of [
      ...expectedPublicLinks,
      { label: "Sign in", href: "/auth/login" },
      { label: "Apply", href: "/dashboard/apply" },
    ]) {
      await expect(
        footer.getByRole("link", { name: link.label, exact: true })
      ).toHaveAttribute("href", link.href);
    }
  });

  test("the mobile menu closes after a same-page anchor tap", async ({
    page,
    viewport,
  }) => {
    test.skip((viewport?.width ?? 1280) >= 1024, "Mobile navigation only");
    await page.goto("/");

    const opener = page.getByRole("button", { name: "Open menu" });
    const menu = page.locator("#mobile-menu");
    await opener.click();
    await expect(opener).toHaveAttribute("aria-expanded", "true");
    await expect(menu).toBeVisible();

    await menu.getByRole("link", { name: "How", exact: true }).click();

    await expect(opener).toHaveAttribute("aria-expanded", "false");
    await expect(menu).toBeHidden();
    await expect(page).toHaveURL(/\/#what-we-do$/);
  });

  test("the public 404 keeps the site navigation and a 404 status", async ({
    page,
    viewport,
  }) => {
    const response = await page.goto("/this-does-not-exist");
    expect(response?.status()).toBe(404);
    await expect(
      page.getByRole("heading", { name: "This page isn't here." })
    ).toBeVisible();

    const main = page.locator("main");
    await expect(
      main.getByRole("link", { name: "Builders", exact: true })
    ).toHaveAttribute("href", "/talent");
    await expect(main.getByRole("link", { name: /Blog/ })).toHaveAttribute(
      "href",
      "/blog"
    );
    await expect(main.getByRole("link", { name: /Home/ })).toHaveAttribute(
      "href",
      "/"
    );

    const header = page.locator("header");
    if ((viewport?.width ?? 1280) < 1024) {
      await header.getByRole("button", { name: "Open menu" }).click();
    }
    await expect(
      header.getByRole("link", { name: "Builders", exact: true })
    ).toHaveAttribute("href", "/talent");
    await expect(
      header.getByRole("link", { name: "Blog", exact: true })
    ).toHaveAttribute("href", "/blog");
  });

  test("Apply preserves its destination through the login page", async ({
    page,
  }) => {
    const redirect = await page.request.get("/dashboard/apply", {
      maxRedirects: 0,
    });
    expect(redirect.status()).toBe(302);
    const location = redirect.headers().location;
    expect(location).toBeTruthy();
    const loginUrl = new URL(location!, "https://example.test");
    expect(loginUrl.pathname).toBe("/auth/login");
    expect(loginUrl.searchParams.get("next")).toBe("/dashboard/apply");

    await page.goto(`${loginUrl.pathname}${loginUrl.search}`);
    await expect(
      page.getByRole("button", { name: "Sign in with GitHub" })
    ).toHaveAttribute("data-callback-url", "/dashboard/apply");
    await expect(
      page.getByText("A GitHub account is required to sign in and continue.")
    ).toBeVisible();
    await expect(page.getByText(/mentor notes/i)).toHaveCount(0);
    await expect(page.getByText(/terms of service/i)).toHaveCount(0);
  });

  test("the homepage headline is never cropped by its own box", async ({ page }) => {
    await page.goto("/");
    await page.evaluate(() => document.fonts.ready);

    // 18vw once outgrew the section's padding at 768 and below, and a 5rem
    // floor sheared the final O off on a 390px phone.
    const wordmark = page.getByRole("heading", { level: 1, name: "Great builders. Already here." });
    const overflow = await wordmark.evaluate((el) => el.scrollWidth - el.clientWidth);
    expect(overflow).toBeLessThanOrEqual(TOLERANCE_PX);
  });

  test("homepage commitments appear once and audience routes stay visible", async ({ page }) => {
    await page.goto("/");
    await page.evaluate(() => document.fonts.ready);
    await assertHomepageValues(page);
  });

  test("homepage evidence responds to focus and its fitted footer stays complete", async ({ page }) => {
    await page.goto("/");
    await page.evaluate(() => document.fonts.ready);
    const story = page.locator(".home-story");
    await expect(story.getByText("Fictional illustration", { exact: true })).toBeVisible();
    for (const stage of ["contribution", "mentor", "question"]) {
      await page.locator(`[data-home-stage="${stage}"]`).focus();
      await expect(story).toHaveAttribute("data-active-stage", stage);
    }
    const brand = page.locator("footer .home-footer-lockup span");
    await expect(brand).toHaveText(["TEMBO", "TECH VENTURES"]);
    for (const line of await brand.all()) {
      expect(await line.evaluate((el) => el.scrollWidth - el.clientWidth)).toBeLessThanOrEqual(TOLERANCE_PX);
    }
    await page.emulateMedia({ reducedMotion: "reduce" });
    expect(await page.locator(".home-wordmark-line > span").first().evaluate((el) => el.getAnimations().length)).toBe(0);
  });

  test("footer link columns survive the tablet breakpoint", async ({ page }) => {
    // 768 is where the mission block and the four link columns used to share a
    // row: each column collapsed to ~42px, wrapping "How we work" onto three
    // lines and cutting the "Connect" heading mid-word.
    await page.setViewportSize({ width: 768, height: 1024 });
    await page.goto("/blog");
    await page.evaluate(() => document.fonts.ready);
    await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));

    const headings = page.locator("footer .grid > div > p");
    const headingCount = await headings.count();
    expect(headingCount).toBeGreaterThan(0);
    for (let i = 0; i < headingCount; i += 1) {
      const heading = headings.nth(i);
      const text = (await heading.innerText()).trim();
      const clipped = await heading.evaluate((el) => el.scrollWidth - el.clientWidth);
      expect(clipped, `footer heading "${text}" is truncated`).toBeLessThanOrEqual(TOLERANCE_PX);
    }

    const links = page.locator("footer .grid a");
    const linkCount = await links.count();
    for (let i = 0; i < linkCount; i += 1) {
      const link = links.nth(i);
      const text = (await link.innerText()).trim();
      const lines = await link.evaluate((el) => el.getClientRects().length);
      expect(lines, `footer link "${text}" wraps onto ${lines} lines`).toBe(1);
    }
  });

  for (const path of ["/", "/blog", "/hire", "/auth/login"]) {
    test(`${path} does not scroll sideways`, async ({ page }) => {
      await page.goto(path);
      await page.evaluate(() => document.fonts.ready);
      // Walk the page so scroll-triggered sections lay out before measuring.
      await page.evaluate(async () => {
        const height = document.documentElement.scrollHeight;
        for (let y = 0; y < height; y += 400) {
          window.scrollTo(0, y);
          await new Promise((resolve) => {
            setTimeout(resolve, 30);
          });
        }
      });

      const overflow = await page.evaluate(
        () => document.documentElement.scrollWidth - document.documentElement.clientWidth
      );
      expect(overflow).toBeLessThanOrEqual(TOLERANCE_PX);
    });
  }
});
