import { expect, test } from "@playwright/test";
import { mkdirSync } from "fs";

mkdirSync("test-results/evidence", { recursive: true });

test.describe("authenticated portfolio editor", () => {
  const token = process.env.PLAYWRIGHT_AGENT_TOKEN;
  test.skip(
    !token,
    "No agent bearer token is configured for this environment.",
  );
  test.use({
    extraHTTPHeaders: token ? { Authorization: `Bearer ${token}` } : {},
  });

  test("portfolio editor renders for eligible user", async ({
    page,
  }, testInfo) => {
    await page.goto("/dashboard/portfolio");
    await expect(page).toHaveURL(/\/dashboard\/portfolio/);

    await expect(
      page.getByRole("heading", { name: /portfolio/i }),
    ).toBeVisible();

    const isLocked = await page
      .getByText(/your portfolio unlocks/i)
      .isVisible()
      .catch(() => false);

    if (isLocked) {
      test.skip(true, "User has not completed a cohort — editor is locked");
      return;
    }

    await expect(
      page.locator(
        'form input[name="handle"], form [data-testid="portfolio-editor"]',
      ),
    ).toBeVisible();

    await page.screenshot({
      path: `test-results/evidence/${testInfo.project.name}-portfolio-editor.png`,
      fullPage: true,
    });
  });

  test("portfolio create-or-update convergent journey", async ({
    page,
  }, testInfo) => {
    const isMobile = testInfo.project.name.includes("mobile");
    if (isMobile) {
      test.skip(true, "Mutation journeys run on desktop only");
      return;
    }

    await page.goto("/dashboard/portfolio");

    const isLocked = await page
      .getByText(/your portfolio unlocks/i)
      .isVisible()
      .catch(() => false);
    if (isLocked) {
      test.skip(true, "User has not completed a cohort");
      return;
    }

    const handleInput = page.locator('input[name="handle"]');
    const hasExistingProfile = await handleInput
      .evaluate((el) => (el as HTMLInputElement).value !== "")
      .catch(() => false);

    const SENTINEL_BIO = "Convergent e2e portfolio test sentinel";

    if (hasExistingProfile) {
      const bioField = page.locator('textarea[name="bio"]');
      await bioField.fill(SENTINEL_BIO);
    } else {
      await handleInput.fill("preview-agent");
      await page.locator('input[name="headline"]').fill("E2E Test Builder");
      await page.locator('textarea[name="bio"]').fill(SENTINEL_BIO);
    }

    await page.getByRole("button", { name: /save|create/i }).click();
    await page.waitForLoadState("networkidle");

    await expect(
      page.getByText(/profile saved/i).or(page.locator('input[name="handle"]')),
    ).toBeVisible();

    await page.reload();
    await page.waitForLoadState("networkidle");

    const bioValue = await page
      .locator('textarea[name="bio"]')
      .inputValue();
    expect(bioValue).toBe(SENTINEL_BIO);

    await page.screenshot({
      path: `test-results/evidence/${testInfo.project.name}-portfolio-saved.png`,
      fullPage: true,
    });
  });

  test("repo picker shows graceful no-token state", async ({
    page,
  }, testInfo) => {
    await page.goto("/dashboard/portfolio");

    const isLocked = await page
      .getByText(/your portfolio unlocks/i)
      .isVisible()
      .catch(() => false);
    if (isLocked) {
      test.skip(true, "User has not completed a cohort");
      return;
    }

    const hasProfile = await page
      .getByText(/github highlights/i)
      .isVisible()
      .catch(() => false);

    if (!hasProfile) {
      test.skip(true, "No profile exists yet — repo picker not rendered");
      return;
    }

    await page.waitForTimeout(2000);

    const noTokenNotice = page.getByText(
      /couldn't reach your github account/i,
    );
    const repoList = page.getByText(/your repositories/i);

    await expect(noTokenNotice.or(repoList)).toBeVisible();

    await page.screenshot({
      path: `test-results/evidence/${testInfo.project.name}-repo-picker.png`,
      fullPage: true,
    });
  });

  test("leads page renders", async ({ page }, testInfo) => {
    await page.goto("/dashboard/leads");
    await expect(page).toHaveURL(/\/dashboard\/leads/);

    await expect(
      page.getByRole("heading", { name: /leads/i }),
    ).toBeVisible();

    const hasContent = await page
      .getByText(
        /no leads yet|when someone reaches you|set up your portfolio|mark read/i,
      )
      .first()
      .isVisible()
      .catch(() => false);

    expect(hasContent).toBe(true);

    await page.screenshot({
      path: `test-results/evidence/${testInfo.project.name}-leads-page.png`,
      fullPage: true,
    });
  });
});
