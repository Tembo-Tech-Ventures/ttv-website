import { expect, test } from "@playwright/test";
import { mkdirSync } from "fs";
import { FIXTURE_ENVIRONMENT } from "./fixture-env";

mkdirSync("test-results/evidence", { recursive: true });

test.describe("Google Drive recording import", () => {
  const token = process.env.PLAYWRIGHT_AGENT_TOKEN;
  test.skip(
    !FIXTURE_ENVIRONMENT || !token,
    "Requires an authenticated isolated agent preview."
  );
  test.use({
    extraHTTPHeaders: token ? { Authorization: `Bearer ${token}` } : {},
  });

  test("import page loads and shows credential status", async ({
    page,
  }, testInfo) => {
    await page.goto("/admin/recordings/import");

    await expect(
      page.getByRole("heading", { name: "Import Session Recordings" })
    ).toBeVisible();

    const notConfigured = page.getByTestId("drive-not-configured");
    const configured = page.getByText(
      "Service account credentials are configured.",
      { exact: true }
    );
    await expect(notConfigured.or(configured)).toBeVisible();

    if (await notConfigured.isVisible()) {
      await expect(notConfigured).toContainText("not configured");
      const integrationsLink = page.getByRole("link", {
        name: /Integrations/,
      });
      await expect(integrationsLink).toBeVisible();
      await expect(integrationsLink).toHaveAttribute(
        "href",
        "/admin/settings/integrations"
      );
    }

    await page.screenshot({
      path: `test-results/evidence/${testInfo.project.name}-drive-import.png`,
      fullPage: true,
    });
  });

  test("recordings index links to the import page", async ({ page }) => {
    await page.goto("/admin/recordings");

    const importLink = page.getByRole("link", {
      name: "Import from Drive",
      exact: true,
    });
    await expect(importLink).toBeVisible();
    await expect(importLink).toHaveAttribute(
      "href",
      "/admin/recordings/import"
    );
  });

  test("import page requires admin access", async ({ request }) => {
    const response = await request.get("/admin/recordings/import", {
      headers: {},
      maxRedirects: 0,
    });
    expect([301, 302, 303]).toContain(response.status());
  });
});
