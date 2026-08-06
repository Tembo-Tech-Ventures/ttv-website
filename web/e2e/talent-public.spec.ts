import { expect, test } from "@playwright/test";
import { mkdirSync } from "fs";
import { FIXTURE_ENVIRONMENT } from "./fixture-env";
import { HONEYPOT_FIELD } from "../src/lib/spam/protection";

const EVIDENCE_DIR = "test-results/evidence";
mkdirSync(EVIDENCE_DIR, { recursive: true });

const evidence = (name: string) =>
  `${EVIDENCE_DIR}/${test.info().project.name}-${name}.png`;

test.describe("public talent directory", () => {
  test.skip(!FIXTURE_ENVIRONMENT, "Requires seeded fixtures (agent-* environments only).");
  test("/talent renders the amina-preview card", async ({ page }) => {
    const response = await page.goto("/talent");
    expect(response?.status()).toBe(200);
    await expect(page.getByText("Amina Fixture")).toBeVisible();
    await expect(
      page.getByText("Invalid Completion Fixture")
    ).toHaveCount(0);
    await expect(
      page.getByText("Full-stack developer", { exact: false }),
    ).toBeVisible();
    await page.screenshot({
      path: evidence("talent-directory"),
      fullPage: true,
    });
  });

  test("filter skill=TypeScript still shows amina", async ({ page }) => {
    await page.goto("/talent?skill=TypeScript");
    await expect(page.getByText("Amina Fixture")).toBeVisible();
    await page.screenshot({
      path: evidence("talent-filter-typescript"),
      fullPage: true,
    });
  });

  test("filter skill=zzz-nonexistent shows no-results state", async ({
    page,
  }) => {
    await page.goto("/talent?skill=zzz-nonexistent");
    await expect(page.getByText("Amina Fixture")).not.toBeVisible();
    await expect(
      page.getByText("No builders match your current filters"),
    ).toBeVisible();
    await page.screenshot({
      path: evidence("talent-filter-empty"),
      fullPage: true,
    });
  });
});

test.describe("public talent profile", () => {
  test("/talent/amina-preview renders all sections", async ({ page }) => {
    test.skip(!FIXTURE_ENVIRONMENT, "Requires seeded fixtures (agent-* environments only).");
    const response = await page.goto("/talent/amina-preview");
    expect(response?.status()).toBe(200);

    await expect(
      page.getByRole("heading", { name: /Amina Fixture/i }),
    ).toBeVisible();
    await expect(
      page.getByText("Full-stack developer", { exact: false }),
    ).toBeVisible();
    await expect(page.getByText(/Verified by TTV/i)).toBeVisible();
    await expect(
      page.getByLabel("Skills").getByText("TypeScript"),
    ).toBeVisible();
    await expect(
      page.locator('form[aria-label="Contact form"]'),
    ).toBeVisible();

    await page.screenshot({
      path: evidence("talent-profile-amina"),
      fullPage: true,
    });
  });

  test("/talent/amina-preview renders highlights with blurbs", async ({
    page,
  }) => {
    test.skip(!FIXTURE_ENVIRONMENT, "Requires seeded fixtures (agent-* environments only).");
    await page.goto("/talent/amina-preview");
    await expect(page.getByText(/Highlighted work/i)).toBeVisible();
    const highlights = page.locator("section[aria-label='Highlighted work'] > div > div");
    await expect(highlights.first()).toBeVisible();
  });

  test("published profile without a valid completion returns 404", async ({
    page,
  }) => {
    test.skip(!FIXTURE_ENVIRONMENT, "Requires seeded fixtures (agent-* environments only).");
    const response = await page.goto("/talent/invalid-completion-preview");
    expect(response?.status()).toBe(404);
    await expect(
      page.getByRole("link", { name: /browse all builders/i }),
    ).toBeVisible();
  });

  test("/talent/definitely-not-a-handle-xyz returns 404", async ({
    page,
  }) => {
    const response = await page.goto(
      "/talent/definitely-not-a-handle-xyz",
    );
    expect(response?.status()).toBe(404);
    await expect(
      page.getByRole("link", { name: /browse all builders/i }),
    ).toBeVisible();
    await page.screenshot({
      path: evidence("talent-profile-404"),
      fullPage: true,
    });
  });
});

test.describe("public completion certificates", () => {
  test.skip(!FIXTURE_ENVIRONMENT, "Requires seeded fixtures (agent-* environments only).");

  test("valid completion serves its certificate", async ({ page }) => {
    const response = await page.goto("/certificate/ttv-fixture-app-amina");
    expect(response?.status()).toBe(200);
    await expect(
      page.getByRole("heading", { name: "Certificate of Completion" }),
    ).toBeVisible();
  });

  test("COMPLETED row without completedAt returns 404", async ({ page }) => {
    const response = await page.goto(
      "/certificate/ttv-fixture-app-invalid-completion",
    );
    expect(response?.status()).toBe(404);
    await expect(
      page.getByRole("heading", { name: "Certificate Not Available" }),
    ).toBeVisible();
  });
});

test.describe("contact form (desktop-only mutations)", () => {
  test.skip(!FIXTURE_ENVIRONMENT, "Requires seeded fixtures (agent-* environments only).");
  test("contact submit shows success", async ({ page, viewport }) => {
    const isMobile = (viewport?.width ?? 1280) < 768;
    test.skip(isMobile, "Contact form submission is desktop-only");

    await page.goto("/talent/amina-preview");

    await page.getByLabel("Name").fill("E2E Tester");
    await page.getByLabel("Email").fill("e2e@example.com");
    await page.getByLabel("Message").fill("Hello from the e2e test suite.");
    // Token requires MIN_FILL_SECONDS=3 to elapse before submission
    await page.waitForTimeout(3500);
    await page.getByRole("button", { name: /send note/i }).click();

    await expect(page.getByText(/on its way/i)).toBeVisible();
    await page.screenshot({
      path: evidence("talent-contact-success"),
      fullPage: true,
    });
  });

  test("honeypot path still shows success", async ({ page, viewport }) => {
    const isMobile = (viewport?.width ?? 1280) < 768;
    test.skip(isMobile, "Honeypot test is desktop-only");

    await page.goto("/talent/amina-preview");

    await page.getByLabel("Name").fill("Bot Tester");
    await page.getByLabel("Email").fill("bot@example.com");
    await page.getByLabel("Message").fill("I am a bot.");
    await page
      .locator(`input[name="${HONEYPOT_FIELD}"]`)
      .fill("spam-value", { force: true });
    await page.getByRole("button", { name: /send note/i }).click();

    await expect(page.getByText(/on its way/i)).toBeVisible();
    await page.screenshot({
      path: evidence("talent-contact-honeypot"),
      fullPage: true,
    });
  });
});

test.describe("homepage humans section", () => {
  test.skip(!FIXTURE_ENVIRONMENT, "Requires seeded fixtures (agent-* environments only).");
  test("HumansSection shows amina as a solid card", async ({ page }) => {
    await page.goto("/");
    const section = page.locator("#humans");
    await expect(section.getByText("Amina Fixture")).toBeVisible();
    const aminaLink = section.locator('a[href="/talent/amina-preview"]');
    await expect(aminaLink).toBeVisible();
    await expect(
      section.getByText("Invalid Completion Fixture")
    ).toHaveCount(0);
    await page.screenshot({
      path: evidence("homepage-humans"),
      fullPage: true,
    });
  });
});
