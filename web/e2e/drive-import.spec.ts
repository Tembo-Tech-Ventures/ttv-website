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
    await expect(page.getByText(/review historical counts/i)).toBeVisible();

    const notConfigured = page.getByTestId("drive-not-configured");
    const configured = page.getByText(
      "Service account credentials are configured.",
      { exact: true }
    );
    await expect(notConfigured.or(configured)).toBeVisible();

    if (await notConfigured.isVisible()) {
      await expect(notConfigured).toContainText("not configured");
      // Scoped to the banner: the admin sidebar also has an Integrations link.
      const integrationsLink = notConfigured.getByRole("link", {
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

});

// Deliberately outside the authenticated describe: extraHTTPHeaders would
// merge the agent bearer token into the request and defeat the check.
test.describe("drive import non-admin access", () => {
  test("unauthenticated users are redirected to login", async ({ page }) => {
    await page.goto("/admin/recordings/import");
    expect(page.url()).toContain("/auth/login");
  });
});
