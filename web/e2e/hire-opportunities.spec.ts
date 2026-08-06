import { expect, test } from "@playwright/test";
import { mkdirSync } from "fs";

const EVIDENCE_DIR = "test-results/evidence";
mkdirSync(EVIDENCE_DIR, { recursive: true });

const evidence = (name: string) =>
  `${EVIDENCE_DIR}/${test.info().project.name}-${name}.png`;

test.describe("/hire public page", () => {
  test("renders pitch section with heading and form", async ({ page }) => {
    const response = await page.goto("/hire");
    expect(response?.status()).toBe(200);

    await expect(
      page.getByRole("heading", { name: /work with/i })
    ).toBeVisible();

    await expect(page.getByText(/connect your project/i)).toBeVisible();
    await expect(
      page.getByRole("link", { name: /meet the builders/i })
    ).toBeVisible();

    await expect(
      page.getByRole("heading", { name: /tell us about your project/i })
    ).toBeVisible();

    await expect(page.getByLabel(/organization/i)).toBeVisible();
    await expect(page.getByLabel(/your name/i)).toBeVisible();
    await expect(page.getByLabel(/email/i)).toBeVisible();
    await expect(page.getByLabel(/project title/i)).toBeVisible();
    await expect(page.getByLabel(/description/i)).toBeVisible();
    await expect(page.getByLabel(/budget range/i)).toBeVisible();

    await page.screenshot({
      path: evidence("hire-page"),
      fullPage: true,
    });
  });

  test("renders value points", async ({ page }) => {
    await page.goto("/hire");

    await expect(
      page.getByRole("heading", { name: /cohort-trained/i })
    ).toBeVisible();
    await expect(
      page.getByRole("heading", { name: /you work together/i })
    ).toBeVisible();
    await expect(
      page.getByRole("heading", { name: /ecosystem impact/i })
    ).toBeVisible();
  });

  test("renders what happens next section", async ({ page }) => {
    await page.goto("/hire");
    await expect(page.getByText(/1\. we review/i)).toBeVisible();
    await expect(page.getByText(/2\. builders raise a hand/i)).toBeVisible();
    await expect(page.getByText(/3\. ttv introduces you/i)).toBeVisible();
  });
});

test.describe("/hire form submission", () => {
  test("submit journey creates a project", async ({ page, viewport }) => {
    const isMobile = (viewport?.width ?? 1280) < 768;
    test.skip(isMobile, "Form submissions are desktop-only");

    await page.goto("/hire");

    const uniqueTitle = `E2E Project ${Date.now()}`;

    await page.getByLabel(/organization/i).fill("E2E Test Org");
    await page.getByLabel(/your name/i).fill("Test User");
    await page.getByLabel(/email/i).fill("test@example.com");
    await page.getByLabel(/project title/i).fill(uniqueTitle);
    await page.getByLabel(/description/i).fill("This is an automated test project submission.");
    await page.getByLabel(/skills needed/i).fill("React, TypeScript");
    await page.getByLabel(/budget range/i).selectOption("FROM_1K_TO_5K");
    await page.getByLabel(/timeline/i).fill("4 weeks");

    await page.getByRole("button", { name: /submit project/i }).click();

    await expect(page.getByTestId("hire-success")).toBeVisible();
    await expect(
      page.getByText(/thanks/i)
    ).toBeVisible();
    await expect(
      page.getByText(/the ttv team reviews every project/i)
    ).toBeVisible();

    await page.screenshot({
      path: evidence("hire-submit-success"),
      fullPage: true,
    });
  });

  test("honeypot submission shows success silently", async ({
    page,
    viewport,
  }) => {
    const isMobile = (viewport?.width ?? 1280) < 768;
    test.skip(isMobile, "Form submissions are desktop-only");

    await page.goto("/hire");

    const uniqueTitle = `E2E Honeypot ${Date.now()}`;

    await page.getByLabel(/organization/i).fill("Bot Org");
    await page.getByLabel(/your name/i).fill("Bot");
    await page.getByLabel(/email/i).fill("bot@example.com");
    await page.getByLabel(/project title/i).fill(uniqueTitle);
    await page.getByLabel(/description/i).fill("Honeypot test.");
    await page.getByLabel(/budget range/i).selectOption("UNDISCLOSED");

    await page
      .locator("input[name='website_confirm']")
      .fill("http://spam.com");

    await page.getByRole("button", { name: /submit project/i }).click();

    await expect(page.getByTestId("hire-success")).toBeVisible();

    await page.screenshot({
      path: evidence("hire-honeypot-success"),
      fullPage: true,
    });
  });
});

test.describe("/dashboard/opportunities (authed)", () => {
  const token = process.env.PLAYWRIGHT_AGENT_TOKEN;
  test.skip(!token, "No agent bearer token is configured for this environment.");
  test.use({
    extraHTTPHeaders: token ? { Authorization: `Bearer ${token}` } : {},
  });

  test("shows gated state when profile is not published", async ({
    page,
  }) => {
    await page.goto("/dashboard/opportunities");

    await expect(
      page.getByRole("heading", { name: /opportunities/i })
    ).toBeVisible();

    const gateText = page.getByText(/profile/i);
    await expect(gateText.first()).toBeVisible();

    const portfolioLink = page.getByRole("link", {
      name: /create your profile|go to your profile/i,
    });
    await expect(portfolioLink).toBeVisible();

    await page.screenshot({
      path: evidence("opportunities-gated"),
      fullPage: true,
    });
  });
});
