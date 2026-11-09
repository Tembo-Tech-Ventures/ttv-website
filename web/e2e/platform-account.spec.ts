import { expect, test, type Page } from "@playwright/test";
import { runAxe } from "./platform-axe";
import { localPersonaSession, signIn } from "./platform-personas";

/*
 * Account (/dashboard/account) on the kit (style-guide rollout M12): axe-clean at 1440 and 320 with
 * no sideways scroll, a refused name kept beside a focused danger notice, and a saved one answered
 * with a 303 to the page, which says so once. The local seed only; the name is put back afterwards.
 */
const newcomer = localPersonaSession("newcomer");
const PATH = "/dashboard/account";

async function open(page: Page) {
  const response = await page.goto(PATH);
  expect(response?.status()).toBe(200);
  await page.addStyleTag({ content: "astro-dev-toolbar { display: none !important; }" });
}

async function saveName(page: Page, name: string) {
  const form = page.locator("form[data-account-name]");
  await form.getByLabel("Name", { exact: true }).fill(name);
  await form.getByRole("button", { name: "Save name" }).click();
}

test.describe("Account", () => {
  test.skip(typeof newcomer === "string", typeof newcomer === "string" ? newcomer : "");

  test("is accessible at both widths, keeps a refused name, and says a saved one once", async ({ context, page, baseURL }) => {
    test.skip(test.info().project.name !== "chromium", "The phone width is checked in this test.");
    if (typeof newcomer === "string") return;
    await signIn(context, baseURL!, newcomer);
    await open(page);
    const original = await page.locator("form[data-account-name]").getByLabel("Name", { exact: true }).inputValue();

    await runAxe(page, test.info(), "account");
    await page.setViewportSize({ width: 320, height: 720 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(0);
    await runAxe(page, test.info(), "account-320");
    await page.setViewportSize({ width: 1440, height: 900 });

    try {
      // Spaces get past the browser's `required` and are refused on the server.
      await saveName(page, "   ");
      await expect(page).toHaveTitle(/^Error: /);
      const refused = page.getByRole("alert").filter({ hasText: "Your name wasn't saved" });
      await expect(refused).toBeFocused();
      await expect(page.locator("form[data-account-name]")).toContainText("Enter your name.");

      await saveName(page, "Brian K. Kiprono");
      await expect(page).toHaveURL((url) => url.pathname === PATH && url.search === "");
      await expect(page.getByRole("status").filter({ hasText: "Name saved" })).toBeVisible();
      await expect(page.locator("form[data-account-name]").getByLabel("Name", { exact: true })).toHaveValue("Brian K. Kiprono");
      await page.reload();
      await expect(page.getByText("Name saved")).toHaveCount(0);
    } finally {
      await open(page);
      await saveName(page, original);
      await expect(page).toHaveURL((url) => url.pathname === PATH);
    }
  });
});
