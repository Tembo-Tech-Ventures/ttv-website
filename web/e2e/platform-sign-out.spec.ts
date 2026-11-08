import { expect, test } from "@playwright/test";
import { runAxe } from "./platform-axe";
import { personaSession, signIn } from "./platform-personas";

/**
 * /auth/logout only asks on a GET: link prefetchers, chat-app link previews and browser preloading
 * used to sign people out by fetching it. Only the page's own POST form, or the account menu's, signs
 * out, and that path is proven against a real better-auth in src/pages/auth/_tests/logout.render.test.ts.
 * Nothing here posts, so the seeded persona session survives for every other spec.
 */

test.use({ reducedMotion: "reduce" });

test("a GET to /auth/logout asks, with a POST form, and leaves the person signed in", async ({ browser, baseURL }, testInfo) => {
  const session = personaSession("community");
  test.skip(typeof session === "string", typeof session === "string" ? session : "");
  if (typeof session === "string" || !baseURL) return;
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  await signIn(context, baseURL, session);
  const page = await context.newPage();

  // A prefetch, a preview or a typed URL: twice, to be sure the first did nothing either.
  for (let visit = 0; visit < 2; visit += 1) {
    const response = await page.goto("/auth/logout");
    expect(response?.status()).toBe(200);
    expect(page.url()).toMatch(/\/auth\/logout$/);
  }
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Sign out?");
  const form = page.locator("form[data-sign-out-form]");
  await expect(form).toHaveAttribute("method", "POST");
  await expect(form.getByRole("button", { name: "Sign out" })).toBeVisible();
  await expect(form.getByRole("link", { name: "Stay signed in" })).toHaveAttribute("href", "/dashboard");
  await runAxe(page, testInfo, "sign-out-1440");
  await page.setViewportSize({ width: 320, height: 640 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(320);
  await runAxe(page, testInfo, "sign-out-320");

  // Still signed in: the dashboard opens a space instead of sending the person to sign in.
  await page.goto("/dashboard");
  expect(new URL(page.url()).pathname).toMatch(/^\/dashboard\//);

  // The account menu signs out with a POST to the same page, never a link.
  const menu = page.locator(".spaces-account__panel");
  await expect(menu.locator('a[href="/auth/logout"]')).toHaveCount(0);
  await expect(menu.locator("form[data-shell-sign-out]")).toHaveAttribute("action", "/auth/logout");
  await expect(menu.locator("form[data-shell-sign-out]")).toHaveAttribute("method", "post");
  await context.close();
});
