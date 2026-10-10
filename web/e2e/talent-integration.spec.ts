import { devices, expect, test } from "@playwright/test";
import { mkdirSync } from "fs";

const EVIDENCE_DIR = "test-results/evidence";
mkdirSync(EVIDENCE_DIR, { recursive: true });

const evidence = (name: string) =>
  `${EVIDENCE_DIR}/${test.info().project.name}-${name}.png`;

const token = process.env.PLAYWRIGHT_AGENT_TOKEN;

/**
 * Cross-feature journey: a builder publishes a checked profile, appears publicly,
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

  test("builder sees a held publish on mobile, then publishes on pass", async ({
    page,
    browser,
  }) => {
    await page.context().setExtraHTTPHeaders({
      Authorization: `Bearer ${token}`,
      "x-ttv-profile-check": "pass",
    });
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

    const publishButton = page.getByRole("button", { name: /^publish profile$/i });
    if (await publishButton.isVisible().catch(() => false)) {
      const mobileContext = await browser.newContext({
        ...devices["Pixel 7"],
        baseURL:
          process.env.PLAYWRIGHT_BASE_URL ?? "http://127.0.0.1:4321",
        extraHTTPHeaders: {
          Authorization: `Bearer ${token}`,
          "x-ttv-profile-check": "hold",
        },
      });
      try {
        const mobilePage = await mobileContext.newPage();
        await mobilePage.goto("/dashboard/portfolio");
        await mobilePage
          .getByRole("button", { name: /^publish profile$/i })
          .click();
        await expect(
          mobilePage.getByText(
            /remove phone numbers, email addresses, or id numbers/i
          )
        ).toBeVisible();
        await expect(
          mobilePage.getByRole("button", { name: /^publish profile$/i })
        ).toBeVisible();
        await mobilePage.screenshot({
          path: evidence("integration-02-mobile-held"),
          fullPage: true,
        });
      } finally {
        await mobileContext.close();
      }

      await page.reload();
      await publishButton.click();
    }
    await expect(page.getByText(/live at/i).first()).toBeVisible();
    await page.screenshot({
      path: evidence("integration-03-profile-published"),
      fullPage: true,
    });
  });

  test("a held mobile edit keeps the previous public version live", async ({
    browser,
  }) => {
    const mobileContext = await browser.newContext({
      ...devices["Pixel 7"],
      baseURL: process.env.PLAYWRIGHT_BASE_URL ?? "http://127.0.0.1:4321",
      extraHTTPHeaders: {
        Authorization: `Bearer ${token}`,
        "x-ttv-profile-check": "hold",
      },
    });
    const heldBio = "Held mobile edit must not replace the live profile.";

    try {
      const mobilePage = await mobileContext.newPage();
      await mobilePage.goto("/dashboard/portfolio");
      await mobilePage.locator('textarea[name="bio"]').fill(heldBio);
      await mobilePage.getByRole("button", { name: "Save Changes" }).click();

      await expect(
        mobilePage.getByText(
          /remove phone numbers, email addresses, or id numbers/i
        )
      ).toBeVisible();
      await expect(mobilePage.locator('textarea[name="bio"]')).toHaveValue(
        heldBio
      );
      await mobilePage.goto("/talent/preview-agent");
      await expect(mobilePage.getByText(heldBio)).toHaveCount(0);
      await mobilePage.screenshot({
        path: evidence("integration-04-mobile-held-edit-live-version"),
        fullPage: true,
      });
    } finally {
      await mobileContext.close();
    }
  });

  test("published profile appears publicly and receives a lead", async ({
    page,
  }) => {
    await page.goto("/talent/preview-agent");
    await expect(
      page.getByRole("heading", { name: /ttv preview agent/i })
    ).toBeVisible();
    await page.screenshot({
      path: evidence("integration-05-public-profile"),
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
      path: evidence("integration-06-contact-sent"),
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
      path: evidence("integration-07-lead-inbox"),
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
      path: evidence("integration-08-opportunities"),
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
      path: evidence("integration-09-admin-interest"),
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
      path: evidence("integration-10-homepage-humans"),
      fullPage: true,
    });
  });
});
