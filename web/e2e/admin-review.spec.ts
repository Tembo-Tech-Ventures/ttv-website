import { expect, test } from "@playwright/test";
import { mkdirSync } from "fs";

const EVIDENCE_DIR = "test-results/evidence";
mkdirSync(EVIDENCE_DIR, { recursive: true });

const evidence = (name: string) =>
  `${EVIDENCE_DIR}/${test.info().project.name}-${name}.png`;

test.describe("admin review surfaces", () => {
  const token = process.env.PLAYWRIGHT_AGENT_TOKEN;
  test.skip(
    !token,
    "No agent bearer token is configured for this environment."
  );
  test.use({
    extraHTTPHeaders: token ? { Authorization: `Bearer ${token}` } : {},
  });

  test("profiles index renders rows for fixture profiles", async ({
    page,
  }) => {
    await page.goto("/admin/profiles");
    await expect(
      page.getByRole("heading", { name: /profiles/i })
    ).toBeVisible();

    const table = page.locator("table");
    await expect(table).toBeVisible();

    await expect(table.getByText("Amina Fixture")).toBeVisible();
    await expect(table.getByText("Kwame Fixture")).toBeVisible();

    await page.screenshot({
      path: evidence("admin-profiles-index"),
      fullPage: true,
    });
  });

  test("profiles index status filter works", async ({ page }) => {
    await page.goto("/admin/profiles?status=PUBLISHED");
    const table = page.locator("table");
    await expect(table.getByText("Amina Fixture")).toBeVisible();

    await page.screenshot({
      path: evidence("admin-profiles-filtered"),
      fullPage: true,
    });
  });

  test("kwame profile detail convergent journey", async ({
    page,
    viewport,
  }) => {
    const isMobile = (viewport?.width ?? 1280) < 1024;

    if (isMobile) {
      await page.goto("/admin/profiles/ttv-fixture-profile-kwame");
    } else {
      await page.goto("/admin/profiles");
      const kwameRow = page.locator("tr", { hasText: "Kwame Fixture" });
      await expect(kwameRow).toBeVisible();
      await kwameRow.getByRole("link", { name: "View" }).click();
    }

    await expect(
      page.getByRole("heading", { name: /profile/i })
    ).toBeVisible();

    await page.screenshot({
      path: evidence("admin-profile-kwame-detail"),
      fullPage: true,
    });

    if (isMobile) return;

    const statusBadge = page.locator(".flex.items-center.gap-3 span").first();
    const statusText =
      (await statusBadge.textContent())
        ?.trim()
        .toUpperCase()
        .replace(" ", "_") ?? "";

    if (statusText === "IN_REVIEW") {
      await page.getByRole("button", { name: /publish/i }).click();
      await expect(
        page.locator("span", { hasText: /published/i }).first()
      ).toBeVisible();
    }

    const currentStatus1 =
      (
        await page
          .locator(".flex.items-center.gap-3 span")
          .first()
          .textContent()
      )
        ?.trim()
        .toUpperCase()
        .replace(" ", "_") ?? "";

    if (currentStatus1 === "PUBLISHED") {
      await page.getByRole("button", { name: /suspend/i }).click();
      await expect(
        page.locator("span", { hasText: /suspended/i }).first()
      ).toBeVisible();
    }

    const currentStatus2 =
      (
        await page
          .locator(".flex.items-center.gap-3 span")
          .first()
          .textContent()
      )
        ?.trim()
        .toUpperCase()
        .replace(" ", "_") ?? "";

    if (currentStatus2 === "SUSPENDED") {
      await page.getByRole("button", { name: /republish/i }).click();
      await expect(
        page.locator("span", { hasText: /published/i }).first()
      ).toBeVisible();
    }

    await page.screenshot({
      path: evidence("admin-profile-kwame-final"),
      fullPage: true,
    });
  });

  test("projects index renders fixture projects", async ({ page }) => {
    await page.goto("/admin/projects");
    await expect(
      page.getByRole("heading", { name: /client projects/i })
    ).toBeVisible();

    const table = page.locator("table");
    await expect(table).toBeVisible();

    await expect(table.getByText("Baraka Health")).toBeVisible();
    await expect(table.getByText("Savanna Logistics")).toBeVisible();

    await page.screenshot({
      path: evidence("admin-projects-index"),
      fullPage: true,
    });
  });

  test("pending project convergent journey", async ({ page, viewport }) => {
    const isMobile = (viewport?.width ?? 1280) < 1024;

    if (isMobile) {
      await page.goto("/admin/projects/ttv-fixture-project-pending");
    } else {
      await page.goto("/admin/projects");
      const row = page.locator("tr", { hasText: "Clinic booking website" });
      await expect(row).toBeVisible();
      await row.getByRole("link", { name: "View" }).click();
    }

    await expect(
      page.getByRole("heading", { name: /clinic booking website/i })
    ).toBeVisible();

    await expect(page.getByText("Fixture Contact")).toBeVisible();
    await expect(
      page.getByRole("link", { name: /contact@baraka-fixture\.invalid/i })
    ).toBeVisible();

    await page.screenshot({
      path: evidence("admin-project-pending-detail"),
      fullPage: true,
    });

    if (isMobile) return;

    const badge = page.locator(".flex.items-center.gap-3 span").first();
    const statusText =
      (await badge.textContent())?.trim().toUpperCase() ?? "";

    if (statusText === "PENDING") {
      await page.getByRole("button", { name: /approve/i }).click();
      await expect(
        page.locator("span", { hasText: /approved/i }).first()
      ).toBeVisible();
    }

    await expect(
      page.locator("span", { hasText: /approved/i }).first()
    ).toBeVisible();

    await page.screenshot({
      path: evidence("admin-project-pending-final"),
      fullPage: true,
    });
  });

  test("approved project detail shows interested builders section", async ({
    page,
    viewport,
  }) => {
    const isMobile = (viewport?.width ?? 1280) < 1024;

    if (isMobile) {
      await page.goto("/admin/projects/ttv-fixture-project-approved");
    } else {
      await page.goto("/admin/projects");
      const row = page.locator("tr", {
        hasText: "Delivery tracking dashboard",
      });
      await expect(row).toBeVisible();
      await row.getByRole("link", { name: "View" }).click();
    }

    await expect(
      page.getByRole("heading", { name: /delivery tracking dashboard/i })
    ).toBeVisible();

    await expect(
      page.getByRole("heading", { name: /interested builders/i })
    ).toBeVisible();

    await page.screenshot({
      path: evidence("admin-project-approved-detail"),
      fullPage: true,
    });
  });

  test("admin dashboard shows review queues", async ({ page }) => {
    await page.goto("/admin");
    await expect(
      page.getByRole("heading", { name: /review queues/i })
    ).toBeVisible();
    await expect(
      page.getByRole("link", { name: /view queue/i }).first()
    ).toBeVisible();

    await page.screenshot({
      path: evidence("admin-dashboard-review-queues"),
      fullPage: true,
    });
  });
});
