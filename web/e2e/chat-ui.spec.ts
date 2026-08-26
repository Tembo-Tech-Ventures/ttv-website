import { expect, test } from "@playwright/test";

test.describe("transcript chat UI mock", () => {
  test.skip(
    Boolean(process.env.PLAYWRIGHT_BASE_URL),
    "The mock chat page is dev-only and intentionally unavailable on deployed environments."
  );

  test("renders discussion history, markdown answers, and timestamped source links", async ({
    page,
  }, testInfo) => {
    await page.goto("/dev/chat-ui");
    await page.evaluate(() => document.fonts.ready);

    await expect(page.getByRole("heading", { name: "Transcript chat UI" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Customer discovery next steps" })).toBeVisible();
    await expect(
      page.locator("li").filter({ hasText: "Run short customer interviews." })
    ).toBeVisible();

    const firstSource = page.getByRole("link", {
      name: /Source 1 6:24 Mentor Hours: Customer Discovery/,
    });
    await expect(firstSource).toHaveAttribute(
      "href",
      "/dashboard/sessions/recording-1?t=384"
    );

    await page
      .getByPlaceholder("Ask a question. Shift+Enter adds a new line.")
      .fill("Summarise the MVP advice");
    await page.keyboard.press("Enter");
    await expect(page.getByText("validate the problem with users")).toBeVisible();

    await page.screenshot({
      path: `tmp/chat-ui-screenshots/playwright-${testInfo.project.name}.png`,
      fullPage: true,
    });
  });
});
