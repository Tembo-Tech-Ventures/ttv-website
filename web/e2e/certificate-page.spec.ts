import { expect, test } from "@playwright/test";
import { mkdirSync } from "fs";
import { FIXTURE_ENVIRONMENT } from "./fixture-env";

const EVIDENCE_DIR = "test-results/evidence";
mkdirSync(EVIDENCE_DIR, { recursive: true });

const evidence = (name: string) =>
  `${EVIDENCE_DIR}/${test.info().project.name}-${name}.png`;

/** Valid COMPLETED application whose student also has a PUBLISHED profile. */
const VALID_CERTIFICATE = "/certificate/ttv-fixture-app-amina";
/** COMPLETED but with a NULL completedAt — must not be treated as issued. */
const INVALID_CERTIFICATE = "/certificate/ttv-fixture-app-invalid-completion";

test.describe("public certificate page", () => {
  test.skip(
    !FIXTURE_ENVIRONMENT,
    "Requires seeded fixtures (agent-* environments only)."
  );

  test("renders the credential for a valid completion", async ({ page }) => {
    const response = await page.goto(VALID_CERTIFICATE);
    expect(response?.status()).toBe(200);

    // The page's heading carries both the document type and the recipient.
    const heading = page.getByRole("heading", { level: 1 });
    await expect(heading).toContainText("Certificate of Completion");
    await expect(heading).toContainText("Amina Fixture");

    await expect(page.getByText("Preview Curriculum")).toBeVisible();
    await expect(page.getByText("Cohort 04")).toBeVisible();

    // The credential id and verification host are what make the page checkable,
    // so they must survive any future restyling.
    await expect(page.getByText("ttv-fixture-app-amina", { exact: true })).toBeVisible();
    await expect(page.getByText("Verify at")).toBeVisible();

    await page.screenshot({ path: evidence("certificate"), fullPage: true });
  });

  test("links to the builder profile when one is published", async ({ page }) => {
    await page.goto(VALID_CERTIFICATE);

    const profileLink = page.getByRole("link", {
      name: /builder profile/i,
    });
    await expect(profileLink).toBeVisible();
    await expect(profileLink).toHaveAttribute("href", "/talent/amina-preview");
  });

  test("offers print and copy-link actions", async ({ page }) => {
    await page.goto(VALID_CERTIFICATE);

    await expect(page.getByRole("button", { name: "Print" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Copy link" })).toBeVisible();
  });

  /*
   * The previous design overflowed horizontally on phones: a fixed 3rem + 2.5rem
   * of nested padding left roughly a 200px content column, and the credential id
   * could not wrap inside it. Guard the whole viewport range rather than a single
   * width so a future change cannot quietly reintroduce it.
   */
  for (const width of [320, 390, 768]) {
    test(`does not scroll horizontally at ${width}px`, async ({ page }) => {
      await page.setViewportSize({ width, height: 900 });
      await page.goto(VALID_CERTIFICATE);

      const overflow = await page.evaluate(
        () =>
          document.documentElement.scrollWidth -
          document.documentElement.clientWidth
      );
      expect(overflow).toBeLessThanOrEqual(0);
    });
  }

  test("404s a COMPLETED application that was never actually issued", async ({
    page,
  }) => {
    const response = await page.goto(INVALID_CERTIFICATE);
    expect(response?.status()).toBe(404);

    await expect(
      page.getByRole("heading", { name: "Certificate not available" })
    ).toBeVisible();
    await expect(page.getByText("Invalid Completion Fixture")).toHaveCount(0);
  });
});
