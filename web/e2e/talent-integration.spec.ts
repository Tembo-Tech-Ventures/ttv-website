import { expect, test } from "@playwright/test";
import { mkdirSync } from "fs";

const EVIDENCE_DIR = "test-results/evidence";
mkdirSync(EVIDENCE_DIR, { recursive: true });

const evidence = (name: string) =>
  `${EVIDENCE_DIR}/${test.info().project.name}-${name}.png`;

const token = process.env.PLAYWRIGHT_AGENT_TOKEN;

/**
 * Cross-feature journey: a builder publishes a profile, appears publicly,
 * receives a lead through the contact relay, reads it, raises a hand for a
 * client project, and the admin sees the interest. Runs in the dedicated
 * "integration" Playwright project AFTER the parallel per-feature suites
 * (see playwright.config.ts project dependencies) because it publishes the
 * preview user's profile, which the opportunities gate test asserts against.
 * Every step converges: it acts only when the current state requires it, so
 * retries and repeated runs on a persistent preview stack stay green.
 */
test.describe.serial("talent platform integration journey", () => {
  test.skip(!token, "No agent bearer token is configured for this environment.");
  test.use({
    extraHTTPHeaders: token ? { Authorization: `Bearer ${token}` } : {},
  });

  test("builder creates, submits, and admin publishes the profile", async ({
    page,
  }) => {
    await page.goto("/dashboard/portfolio");

    const createButton = page.getByRole("button", { name: "Create Profile" });
    if (await createButton.isVisible().catch(() => false)) {
      await page.locator('input[name="handle"]').fill("preview-agent");
      await page
        .locator('input[name="headline"]')
        .fill("Integration journey builder");
      await page
        .locator('textarea[name="bio"]')
        .fill("Profile exercised end-to-end by the integration suite.");
      await createButton.click();
      await expect(
        page.getByRole("button", { name: "Save Changes" })
      ).toBeVisible();
    }
    await page.screenshot({
      path: evidence("integration-01-portfolio"),
      fullPage: true,
    });

    const submitButton = page.getByRole("button", {
      name: /submit for review/i,
    });
    if (await submitButton.isVisible().catch(() => false)) {
      await submitButton.click();
    }

    await page.goto("/admin/profiles");
    const profileRow = page
      .locator("tr", { hasText: "preview-agent" })
      .first();
    await expect(profileRow).toBeVisible();
    await profileRow.getByRole("link", { name: "View" }).click();

    const publishButton = page.getByRole("button", { name: /^publish$/i });
    if (await publishButton.isVisible().catch(() => false)) {
      await publishButton.click();
    }
    await expect(page.getByText(/published/i).first()).toBeVisible();
    await page.screenshot({
      path: evidence("integration-02-admin-published"),
      fullPage: true,
    });
  });

  test("published profile appears publicly and receives a lead", async ({
    page,
  }) => {
    await page.goto("/talent/preview-agent");
    await expect(
      page.getByRole("heading", { name: /ttv preview agent/i })
    ).toBeVisible();
    await page.screenshot({
      path: evidence("integration-03-public-profile"),
      fullPage: true,
    });

    const uniqueMessage = `Integration lead ${Date.now()}`;
    await page.locator('input[name="fromName"]').fill("Integration Client");
    await page
      .locator('input[name="fromEmail"]')
      .fill("client@integration.invalid");
    await page.locator('input[name="organization"]').fill("Integration Org");
    await page.locator('textarea[name="message"]').fill(uniqueMessage);
    // The spam guard enforces a minimum fill time of three seconds.
    await page.waitForTimeout(3_600);
    await page.getByRole("button", { name: /send|get in touch|submit/i }).click();
    await expect(page.getByText(/on its way/i)).toBeVisible();
    await page.screenshot({
      path: evidence("integration-04-contact-sent"),
      fullPage: true,
    });

    await page.goto("/dashboard/leads");
    const leadCard = page
      .locator("li, tr, article, div.rounded-lg")
      .filter({ hasText: uniqueMessage })
      .first();
    await expect(leadCard).toBeVisible();
    const readButton = leadCard.getByRole("button", { name: /read/i }).first();
    if (await readButton.isVisible().catch(() => false)) {
      await readButton.click();
    }
    await expect(page.getByText(uniqueMessage).first()).toBeVisible();
    await page.screenshot({
      path: evidence("integration-05-lead-inbox"),
      fullPage: true,
    });
  });

  test("builder raises a hand and the admin sees the interest", async ({
    page,
  }) => {
    await page.goto("/dashboard/opportunities");
    const projectCard = page
      .locator("section, article, li, div.rounded-lg")
      .filter({ hasText: "Delivery tracking dashboard" })
      .first();
    await expect(projectCard).toBeVisible();

    const withdrawVisible = await projectCard
      .getByRole("button", { name: /withdraw/i })
      .isVisible()
      .catch(() => false);
    if (!withdrawVisible) {
      const noteField = projectCard.locator('textarea[name="note"]');
      if (await noteField.isVisible().catch(() => false)) {
        await noteField.fill("Raised by the integration suite.");
      }
      await projectCard
        .getByRole("button", { name: /raise your hand/i })
        .click();
    }
    await expect(
      page.getByText(/raised your hand|withdraw/i).first()
    ).toBeVisible();
    await page.screenshot({
      path: evidence("integration-06-opportunities"),
      fullPage: true,
    });

    await page.goto("/admin/projects");
    await page
      .locator("tr", { hasText: "Delivery tracking dashboard" })
      .first()
      .getByRole("link", { name: "View" })
      .click();
    const interested = page
      .locator("section, div")
      .filter({ hasText: /interested builders/i })
      .last();
    await expect(
      interested.getByText(/preview.agent|ttv preview agent/i).first()
    ).toBeVisible();
    await page.screenshot({
      path: evidence("integration-07-admin-interest"),
      fullPage: true,
    });
  });

  test("homepage humans section links to published builders", async ({
    page,
  }) => {
    await page.goto("/");
    const humansLink = page.locator('#humans a[href^="/talent/"]').first();
    await expect(humansLink).toBeVisible();
    await page.screenshot({
      path: evidence("integration-08-homepage-humans"),
      fullPage: true,
    });
  });
});
