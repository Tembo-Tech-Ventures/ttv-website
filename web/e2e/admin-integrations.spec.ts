import { expect, test } from "@playwright/test";
import { generateKeyPairSync } from "crypto";
import { mkdirSync } from "fs";
import { FIXTURE_ENVIRONMENT } from "./fixture-env";

const EVIDENCE_DIR = "test-results/evidence";
mkdirSync(EVIDENCE_DIR, { recursive: true });

const evidence = (name: string) =>
  `${EVIDENCE_DIR}/${test.info().project.name}-${name}.png`;

function generateThrowawayServiceAccountJson(): string {
  const { privateKey } = generateKeyPairSync("rsa", {
    modulusLength: 2048,
    publicKeyEncoding: { type: "spki", format: "pem" },
    privateKeyEncoding: { type: "pkcs8", format: "pem" },
  });
  return JSON.stringify({
    type: "service_account",
    project_id: "e2e-test-project",
    private_key_id: "e2e-key-id-1234567890",
    private_key: privateKey,
    client_email: "e2e-test@e2e-test-project.iam.gserviceaccount.com",
    client_id: "123456789",
    auth_uri: "https://accounts.google.com/o/oauth2/auth",
    token_uri: "https://oauth2.googleapis.com/token",
  });
}

test.describe("admin integrations page", () => {
  const token = process.env.PLAYWRIGHT_AGENT_TOKEN;
  test.skip(
    !token,
    "No agent bearer token is configured for this environment."
  );
  test.skip(!FIXTURE_ENVIRONMENT, "Requires an isolated agent-* environment.");
  test.use({
    extraHTTPHeaders: token ? { Authorization: `Bearer ${token}` } : {},
  });

  test("loads the integrations page for an admin", async ({ page }) => {
    await page.goto("/admin/settings/integrations");
    await expect(
      page.getByRole("heading", { name: /integrations/i })
    ).toBeVisible();
    await page.screenshot({
      path: evidence("admin-integrations-initial"),
      fullPage: true,
    });
  });

  test("save, verify metadata, replace, and remove credential flow", async ({
    page,
  }) => {
    // The credential is a singleton per environment, so two browser projects
    // running this flow concurrently corrupt each other's state. The
    // read-only test above keeps cross-device coverage.
    test.skip(
      test.info().project.name !== "chromium",
      "Mutating flow runs on a single project against the shared environment."
    );

    await page.goto("/admin/settings/integrations");

    // A prior failed attempt can leave a credential configured; reset first
    // so retries always start from the unconfigured state. Exact matching
    // keeps audit-log rows (e.g. "remove Credential removed.") out of scope.
    if (
      (await page.getByText("Remove credential", { exact: true }).count()) > 0
    ) {
      await page.getByText("Remove credential", { exact: true }).click();
      await page.getByRole("button", { name: /confirm removal/i }).click();
      await expect(
        page.getByText("Google Drive credential removed.")
      ).toBeVisible();
    }

    const saJson = generateThrowawayServiceAccountJson();
    await page.locator('textarea[name="serviceAccountJson"]').fill(saJson);
    await page.locator('input[name="impersonatedUser"]').fill("admin@example.com");
    await page.getByRole("button", { name: /save credential/i }).click();

    await expect(
      page.getByText("Google Drive credential saved.")
    ).toBeVisible();
    await expect(
      page.getByText("e2e-test@e2e-test-project.iam.gserviceaccount.com")
    ).toBeVisible();
    await expect(
      page.getByText("e2e-test-project", { exact: true })
    ).toBeVisible();
    await expect(
      page.getByText("admin@example.com", { exact: true })
    ).toBeVisible();

    const responseBody = await page.content();
    const parsed = JSON.parse(saJson);
    expect(responseBody).not.toContain(parsed.private_key.substring(40, 80));

    await page.screenshot({
      path: evidence("admin-integrations-configured"),
      fullPage: true,
    });

    await page.getByText("Replace credential", { exact: true }).click();
    const replacementJson = generateThrowawayServiceAccountJson();
    await page
      .locator('details:has(input[value="replace"]) textarea[name="serviceAccountJson"]')
      .fill(replacementJson);
    await page
      .locator('details:has(input[value="replace"])')
      .getByRole("button", { name: /replace/i })
      .click();

    await expect(
      page.getByText("Google Drive credential replaced.")
    ).toBeVisible();
    await page.screenshot({
      path: evidence("admin-integrations-replaced"),
      fullPage: true,
    });

    await page.getByText("Remove credential", { exact: true }).click();
    await page.getByRole("button", { name: /confirm removal/i }).click();

    await expect(
      page.getByText("Google Drive credential removed.")
    ).toBeVisible();
    await expect(
      page.locator('textarea[name="serviceAccountJson"]')
    ).toBeVisible();
    await page.screenshot({
      path: evidence("admin-integrations-removed"),
      fullPage: true,
    });
  });
});

test.describe("admin integrations non-admin redirect", () => {
  test("unauthenticated users are redirected to login", async ({ page }) => {
    await page.goto("/admin/settings/integrations");
    const url = page.url();
    expect(url).toContain("/auth/login");
  });
});
