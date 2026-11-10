import { expect, test } from "@playwright/test";
import { runAxe } from "./platform-axe";
import { localPersonaSession, signIn } from "./platform-personas";

/*
 * The one profile editor (/dashboard/me/portfolio): axe-clean at 1440 and 320 with no sideways scroll,
 * where the public listing stands, and a refused save that keeps every value beside a focused danger
 * notice. The local seed's alumna, whose profile is on the public website; nothing is saved.
 */
const alumna = localPersonaSession("alumna");
const PATH = "/dashboard/me/portfolio";

test.describe("The profile editor", () => {
  test.skip(typeof alumna === "string", typeof alumna === "string" ? alumna : "");

  test("is accessible at both widths, and keeps what was typed when a save is refused", async ({ context, page, baseURL }) => {
    test.skip(test.info().project.name !== "chromium", "The phone width is checked in this test.");
    if (typeof alumna === "string") return;
    await signIn(context, baseURL!, alumna);
    expect((await page.goto(PATH))?.status()).toBe(200);
    await page.addStyleTag({ content: "astro-dev-toolbar { display: none !important; }" });
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("Your profile");
    await expect(page.locator("[data-public-site='live']")).toContainText("You're on the public website at /talent/achieng-otieno");
    await expect(page.locator("#profile-visibility")).toContainText("Everyone signed in to TTV can see your profile and everything you post.");

    await runAxe(page, test.info(), "portfolio");
    await page.setViewportSize({ width: 320, height: 720 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(0);
    await runAxe(page, test.info(), "portfolio-320");
    await page.setViewportSize({ width: 1440, height: 900 });

    const editor = page.locator("[data-profile-form] form");
    const tooLong = "A skill name well over thirty characters long";
    await editor.getByLabel(/^About you/).fill("Kept after a refusal.");
    await editor.getByLabel(/^Skills/).fill(tooLong);
    // The browser's own pattern check would stop it first; the server must refuse it too.
    const [response] = await Promise.all([
      page.waitForNavigation(),
      editor.evaluate((form: HTMLFormElement) => form.submit()),
    ]);
    expect(response?.status()).toBe(400);
    await expect(page).toHaveTitle(/^Error: /);
    await expect(page.getByRole("alert").filter({ hasText: "Your profile wasn't saved" })).toBeFocused();
    await expect(editor.getByLabel(/^About you/)).toHaveValue("Kept after a refusal.");
    await expect(editor.getByLabel(/^Skills/)).toHaveValue(tooLong);
    await expect(editor.getByLabel(/^Skills/)).toHaveAttribute("aria-invalid", "true");
  });
});
