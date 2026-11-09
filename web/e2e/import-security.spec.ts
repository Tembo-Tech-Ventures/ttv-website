import { feedbackApiRequest as safeApiRequest } from "../scripts/cloudflare/feedback-browser-guard.mjs";
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
      page.getByRole("heading", { level: 1, name: "Data migration" })
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

    // Privilege records only: the review runs the import's checks and writes nothing.
    const privilegeOnlyExport = {
      version: 1,
      exportedAt: "2026-08-01T12:00:00.000Z",
      roles: [{ id: "legacy-role", name: "ADMIN" }],
    };
    await page.getByLabel("Legacy JSON export").setInputFiles({
      name: "export.json",
      mimeType: "application/json",
      buffer: Buffer.from(JSON.stringify(privilegeOnlyExport)),
    });
    await page.getByRole("button", { name: "Review export" }).click();
    await expect(
      page.getByRole("table", { name: "Records in this export" })
    ).toBeVisible();
    await expect(
      page.getByText("Import unavailable for agent sessions", { exact: false })
    ).toBeVisible();
    await expect(page.getByRole("button", { name: /^Import / })).toHaveCount(0);

    await page.screenshot({
      path: `test-results/evidence/${testInfo.project.name}-import-containment.png`,
      fullPage: true,
    });
  });

  test("rejects foreign-origin and bearer import requests without data", async ({
    page,
    baseURL,
  }) => {
    await page.goto("/admin/data-migration");
    const origin = new URL(page.url()).origin;
    const nonImportPayload = {
      version: 1,
      exportedAt: "2026-08-01T12:00:00.000Z",
    };

    const foreignOrigin = await safeApiRequest(page.request, baseURL!, "/api/admin/import", { method: "POST",
      headers: { Origin: "https://foreign.example" },
      data: nonImportPayload,
    });
    expect(foreignOrigin.status()).toBe(403);
    expect(await foreignOrigin.text()).toContain(
      "same-origin admin request is required"
    );

    const bearerSession = await safeApiRequest(page.request, baseURL!, "/api/admin/import", { method: "POST",
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
