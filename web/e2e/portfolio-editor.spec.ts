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

  test("the profile editor renders for everyone signed in", async ({
    page,
  }, testInfo) => {
    await page.goto("/dashboard/portfolio");
    await expect(page).toHaveURL(/\/dashboard\/(?:me\/)?portfolio/);

    await expect(
      // "Your profile", the one editor in the Profile space.
      page.getByRole("heading", { level: 1, name: /^(portfolio|your profile)$/i }),
    ).toBeVisible();

    // The profile form; once a profile is saved its handle is a fixed value, not a field to type in.
    await expect(page.locator("[data-profile-form] form")).toBeVisible();
    await expect(page.locator('[data-profile-form] form input[name="handle"]')).toHaveCount(1);

    await page.screenshot({
      path: `test-results/evidence/${testInfo.project.name}-portfolio-editor.png`,
      fullPage: true,
    });
  });

  test("invalid skill keeps the submitted bio and shows the field error", async ({
    page,
  }, testInfo) => {
    await page.goto("/dashboard/portfolio");


    const handleInput = page.locator('input[name="handle"]');
    if ((await handleInput.inputValue()) === "") {
      await handleInput.fill("preview-agent");
    }

    const sentinelBio = `Preserved ${testInfo.project.name} bio`;
    const invalidSkill = "x".repeat(31);
    await page.locator('textarea[name="bio"]').fill(sentinelBio);
    await page.locator('input[name="skills"]').fill(invalidSkill);

    const editor = page.locator('form:has(input[name="handle"])');
    const [response] = await Promise.all([
      page.waitForNavigation(),
      editor.evaluate((form: HTMLFormElement) => form.submit()),
    ]);

    expect(response?.status()).toBe(400);
    await expect(page.locator('textarea[name="bio"]')).toHaveValue(sentinelBio);
    await expect(page.locator('input[name="skills"]')).toHaveValue(invalidSkill);
    await expect(page.locator("#skills-error")).toContainText("30");
    // One focused danger notice; the error itself sits under the field.
    await expect(
      page.getByRole("alert").filter({ hasText: "Your profile wasn't saved" }),
    ).toBeFocused();
    await page.screenshot({
      path: `test-results/evidence/${testInfo.project.name}-portfolio-invalid-skill.png`,
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

    await page.getByRole("button", { name: /^(save profile|make my profile)$/i }).click();
    await page.waitForLoadState("networkidle");

    await expect(
      page.getByText(/^profile saved/i),
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


    const hasProfile = await page
      .getByText(/github repositories/i)
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
    await expect(page).toHaveURL(/\/dashboard\/(?:me\/)?leads/);

    await expect(
      // "Visitor messages" inside the spaces shell.
      page.getByRole("heading", { name: /^(Leads|Visitor messages)$/ }),
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
