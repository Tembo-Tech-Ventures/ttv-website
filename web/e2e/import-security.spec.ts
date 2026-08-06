import { expect, test } from "@playwright/test";
import { mkdirSync } from "fs";
import { FIXTURE_ENVIRONMENT } from "./fixture-env";

mkdirSync("test-results/evidence", { recursive: true });

test.describe("legacy import containment", () => {
  const token = process.env.PLAYWRIGHT_AGENT_TOKEN;
  test.skip(
    !FIXTURE_ENVIRONMENT || !token,
    "Requires an authenticated isolated agent preview."
  );
  test.use({
    extraHTTPHeaders: token ? { Authorization: `Bearer ${token}` } : {},
  });

  test("shows migration and privilege containment messaging", async ({
    page,
  }, testInfo) => {
    await page.goto("/admin/data-migration");

    await expect(
      page.getByRole("heading", { name: "Data Migration" })
    ).toBeVisible();
    await expect(page.getByText("Migration testing only")).toBeVisible();
    await expect(
      page.getByTestId("privilege-import-policy")
    ).toContainText("Roles");
    await expect(
      page.getByTestId("privilege-import-policy")
    ).toContainText("always ignored");
    await expect(page.getByTestId("agent-import-warning")).toContainText(
      "cannot run a legacy import"
    );
    await expect(
      page.getByRole("button", {
        name: "Import unavailable for agent sessions",
      })
    ).toBeDisabled();

    await page.screenshot({
      path: `test-results/evidence/${testInfo.project.name}-import-containment.png`,
      fullPage: true,
    });
  });

  test("rejects foreign-origin and bearer import requests without data", async ({
    page,
  }) => {
    await page.goto("/admin/data-migration");
    const origin = new URL(page.url()).origin;
    const nonImportPayload = {
      version: 1,
      exportedAt: "2026-08-01T12:00:00.000Z",
    };

    const foreignOrigin = await page.request.post("/api/admin/import", {
      headers: { Origin: "https://foreign.example" },
      data: nonImportPayload,
    });
    expect(foreignOrigin.status()).toBe(403);
    expect(await foreignOrigin.text()).toContain(
      "same-origin admin request is required"
    );

    const bearerSession = await page.request.post("/api/admin/import", {
      headers: { Origin: origin },
      data: nonImportPayload,
    });
    expect(bearerSession.status()).toBe(403);
    expect(await bearerSession.text()).toContain(
      "Temporary agent sessions cannot perform legacy imports"
    );

    await page.reload();
    await expect(page.getByTestId("agent-import-warning")).toBeVisible();
  });
});
