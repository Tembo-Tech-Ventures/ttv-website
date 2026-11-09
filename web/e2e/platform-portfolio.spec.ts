import { expect, test } from "@playwright/test";
import { runAxe } from "./platform-axe";
import { localPersonaSession, signIn } from "./platform-personas";

/*
 * The public profile editor (/dashboard/me/portfolio) on the kit (style-guide rollout M13): axe-clean at
 * 1440 and 320 with no sideways scroll, and a refused save that keeps every value beside a focused
 * danger notice. The local seed's alumna, whose profile is published; nothing is saved.
 */
const alumna = localPersonaSession("alumna");
const PATH = "/dashboard/me/portfolio";

test.describe("Public profile editor", () => {
  test.skip(typeof alumna === "string", typeof alumna === "string" ? alumna : "");

  test("is accessible at both widths, and keeps what was typed when a save is refused", async ({ context, page, baseURL }) => {
    test.skip(test.info().project.name !== "chromium", "The phone width is checked in this test.");
    if (typeof alumna === "string") return;
    await signIn(context, baseURL!, alumna);
    expect((await page.goto(PATH))?.status()).toBe(200);
    await page.addStyleTag({ content: "astro-dev-toolbar { display: none !important; }" });
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("Public profile");
    await expect(page.locator("[data-profile-status='PUBLISHED']")).toContainText("Live at");

    await runAxe(page, test.info(), "portfolio");
    await page.setViewportSize({ width: 320, height: 720 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(0);
    await runAxe(page, test.info(), "portfolio-320");
    await page.setViewportSize({ width: 1440, height: 900 });

    const editor = page.locator("#profile-editor");
    const tooLong = "A skill name well over thirty characters long";
    await editor.getByLabel("Bio").fill("Kept after a refusal.");
    await editor.getByLabel("Skills").fill(tooLong);
    // The browser's own pattern check would stop it first; the server must refuse it too.
    const [response] = await Promise.all([
      page.waitForNavigation(),
      editor.evaluate((form: HTMLFormElement) => form.submit()),
    ]);
    expect(response?.status()).toBe(400);
    await expect(page).toHaveTitle(/^Error: /);
    await expect(page.getByRole("alert").filter({ hasText: "Your profile wasn't saved" })).toBeFocused();
    await expect(editor.getByLabel("Bio")).toHaveValue("Kept after a refusal.");
    await expect(editor.getByLabel("Skills")).toHaveValue(tooLong);
    await expect(editor.getByLabel("Skills")).toHaveAttribute("aria-invalid", "true");
  });
});
