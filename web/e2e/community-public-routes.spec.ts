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
  await expect(page.getByRole("heading", { level: 1 })).toContainText("Good work.");
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

for (const [audience, headline, cta, destination] of [
  ["members", "Give your work a story.", "Build your community profile", "/dashboard/community"],
  ["mentors", "Make the contribution clearer.", "Continue to mentor review", "/dashboard/mentorship"],
  ["institutions", "Look beyond the profile. Understand the work.", "Continue to institutional access", "/dashboard/discover"],
]) {
  test(`public ${audience} journey reaches GitHub sign-in with the intended return path`, async ({ page, baseURL }) => {
    test.skip(baseURL === "http://127.0.0.1:4322", "Requires actual Astro routes, not the component harness.");
    await page.goto("/community");
    await page.getByRole("navigation", { name: "Community participation" }).getByRole("link", { name: `For ${audience}` }).click();
    await expect(page).toHaveURL(new RegExp(`/community/${audience}$`));
    await expect(page.getByRole("heading", { level: 1 })).toHaveText(headline);
    await expect(page.locator('link[rel="canonical"]')).toHaveAttribute("href", new RegExp(`/community/${audience}$`));
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.getByRole("link", { name: cta }).first().click();
    await expect(page).toHaveURL(new URL(`/auth/login?next=${encodeURIComponent(destination)}`, baseURL!).href);
    await expect(page.getByRole("heading", { name: "Sign in to Tembo." })).toBeVisible();
  });
}

// Preview Better Auth bearer sessions cannot authorize the hydrated community
// API, which requires scoped PATs for Authorization requests. This is NOT an
// authenticated acceptance result. Real success/role assertions belong to the
// protected cookie-persona staging matrix, including ADMIN.
test.skip("authenticated audience workspaces: unsupported with preview bearer; cookie staging acceptance required", () => {});

test("community navigation and disclosures still work after browser Back", async ({ page, baseURL }) => {
  test.skip(baseURL === "http://127.0.0.1:4322", "Requires actual Astro documents and their page lifecycle.");
  await page.goto("/community/members");
  await page.getByRole("link", { name: "Build your community profile" }).first().click();
  await expect(page).toHaveURL(/\/auth\/login/);
  await page.goBack();
  await page.getByRole("link", { name: "See how it works" }).click();
  await expect(page).toHaveURL(/#your-first-contribution$/);
  await expect.poll(() => page.locator("#journey-title").evaluate(el => {
    const box = el.getBoundingClientRect();
    const nav = document.querySelector("header")!.getBoundingClientRect().bottom;
    return box.top >= nav && box.bottom < innerHeight;
  })).toBe(true);
  // A heading can enter the viewport before the smooth anchor scroll ends.
  // Finish that interaction before deliberately scrolling to the FAQ.
  await page.evaluate(() => new Promise<void>(resolve => {
    let previous = scrollY;
    let still = 0;
    const sample = () => {
      still = Math.abs(scrollY - previous) < 0.5 ? still + 1 : 0;
      previous = scrollY;
      if (still >= 4) resolve();
      else requestAnimationFrame(sample);
    };
    requestAnimationFrame(sample);
  }));
  const summary = page.locator("summary").first();
  await summary.evaluate(el => scrollTo({ top: scrollY + el.getBoundingClientRect().top - 220, behavior: "instant" }));
  const before = (await summary.boundingBox())!;
  await summary.click();
  await expect(summary.locator("..")).toHaveAttribute("open", "");
  expect((await summary.boundingBox())!.y).toBeCloseTo(before.y, 0);
});


test("persona cards wait for enhancement without flashing and recover if its module fails", async ({ page, baseURL }) => {
  test.skip(baseURL === "http://127.0.0.1:4322", "Requires the real server-rendered Astro document.");
  // Delay all module scripts while the parser and CSS render the actual SSR cards.
  let release!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  await page.route("**/*.js", async route => { await gate; await route.abort(); });
  try {
    await page.goto("/community/members", { waitUntil: "commit" });
    await expect(page.locator("html")).toHaveAttribute("data-community-motion", "");
    const front = page.locator("[data-card-stack] figure");
    await expect.poll(() => front.evaluate(el => getComputedStyle(el).opacity)).toBe("0");
    // The inline failsafe restores SSR content even when enhancement never loads.
    await expect.poll(() => front.evaluate(el => getComputedStyle(el).opacity), { timeout: 6000 }).toBe("1");
    await expect(page.locator("html")).not.toHaveAttribute("data-community-motion");
  } finally {
    release();
    await page.unrouteAll({ behavior: "wait" });
  }
});

test("late font readiness cannot hide a file already revealed by the fallback", async ({ page, baseURL }) => {
  test.skip(baseURL === "http://127.0.0.1:4322", "Requires the actual early Astro readiness script.");
  await page.addInitScript(() => {
    let release!: () => void;
    const ready = new Promise<void>(resolve => { release = resolve; });
    Object.defineProperty(document.fonts, "ready", { get: () => ready });
    (window as unknown as { releaseMotionFonts: () => void }).releaseMotionFonts = release;
  });
  await page.goto("/community/members");
  const stack = page.locator("[data-card-stack]");
  await expect(page.locator("html")).toHaveAttribute("data-community-motion-fallback", "", { timeout: 6000 });
  expect(await stack.locator("figure").evaluate(el => getComputedStyle(el).opacity)).toBe("1");
  await page.evaluate(() => (window as unknown as { releaseMotionFonts: () => void }).releaseMotionFonts());
  await expect(stack).toHaveClass(/is-settled/);
  await expect(stack).not.toHaveClass(/is-arriving|is-pending/);
  expect(await stack.evaluate(el => el.getAnimations({ subtree: true }).length)).toBe(0);
  expect(await stack.locator("figure").evaluate(el => getComputedStyle(el).opacity)).toBe("1");
});
