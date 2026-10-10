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
    "No agent bearer token is configured for this environment.",
  );
  test.use({
    extraHTTPHeaders: token ? { Authorization: `Bearer ${token}` } : {},
  });

  test("profiles index renders rows for fixture profiles", async ({ page }) => {
    await page.goto("/admin/profiles");
    await expect(
      page.getByRole("heading", { name: /profiles/i }),
    ).toBeVisible();

    const table = page.locator("table");
    await expect(table).toBeVisible();

    await expect(table.getByText("Amina Fixture")).toBeVisible();
    await expect(table.getByText("Kwame Fixture")).toBeVisible();

    const held = page.getByRole("region", { name: "Held by check" });
    await expect(held.getByText("Kwame Fixture")).toBeVisible();
    await expect(
      held.getByRole("button", { name: "Publish", exact: true }),
    ).toBeVisible();
    await expect(
      held.getByRole("button", { name: "Unpublish", exact: true }),
    ).toBeVisible();
    await expect(
      held.getByRole("button", { name: "Clear flag" }),
    ).toBeVisible();

    const unavailable = page.getByRole("region", {
      name: "Published, needs a look (check unavailable)",
    });
    await expect(unavailable.getByText("Amina Fixture")).toBeVisible();
    await expect(
      unavailable.getByRole("button", { name: "Publish", exact: true }),
    ).toBeVisible();
    await expect(
      unavailable.getByRole("button", { name: "Unpublish", exact: true }),
    ).toBeVisible();
    await expect(
      unavailable.getByRole("button", { name: "Clear flag" }),
    ).toBeVisible();

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

  test("kwame profile detail exposes moderation actions", async ({
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

    await expect(page.getByRole("heading", { name: /profile/i })).toBeVisible();

    await page.screenshot({
      path: evidence("admin-profile-kwame-detail"),
      fullPage: true,
    });
    await expect(
      page.getByRole("heading", { name: "Content check" }),
    ).toBeVisible();
    await expect(
      page.getByText(
        "Remove phone numbers, email addresses, or ID numbers from your public profile.",
      ),
    ).toBeVisible();
    await expect(page.getByText("91%", { exact: true })).toHaveCount(0);
    await expect(
      page.getByRole("button", { name: "Publish", exact: true }),
    ).toBeVisible();
    await expect(
      page.getByRole("button", { name: "Unpublish", exact: true }),
    ).toBeVisible();
    await expect(
      page.getByRole("button", { name: "Clear flag" }),
    ).toBeVisible();
  });

  test("admin can suspend and restore a published post", async ({
    page,
    viewport,
  }) => {
    const isMobile = (viewport?.width ?? 1280) < 1024;
    test.skip(isMobile, "Post moderation mutation runs once on desktop");

    await page.goto("/admin/profiles/ttv-fixture-profile-amina#posts");
    const post = page.getByRole("region", {
      name: "Notes on debugging at the edge",
    });
    await expect(post).toBeVisible();
    await post.getByLabel(/admin note/i).fill("Checked in the preview journey");
    await post.getByRole("button", { name: "Suspend post" }).click();

    await expect(
      page
        .getByRole("region", { name: "Notes on debugging at the edge" })
        .getByRole("button", { name: "Restore post" }),
    ).toBeVisible();
    expect(
      (
        await page.request.get("/blog/amina-preview/debugging-at-the-edge")
      ).status(),
    ).toBe(404);

    const suspended = page.getByRole("region", {
      name: "Notes on debugging at the edge",
    });
    await expect(
      suspended.getByText(/Checked in the preview journey/),
    ).toBeVisible();
    await suspended.getByRole("button", { name: "Restore post" }).click();

    await expect(
      page
        .getByRole("region", { name: "Notes on debugging at the edge" })
        .getByRole("button", { name: "Suspend post" }),
    ).toBeVisible();
    expect(
      (
        await page.request.get("/blog/amina-preview/debugging-at-the-edge")
      ).status(),
    ).toBe(200);
  });

  test("projects index renders fixture projects", async ({ page }) => {
    await page.goto("/admin/projects");
    await expect(
      page.getByRole("heading", { name: /client projects/i }),
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
      page.getByRole("heading", { name: /clinic booking website/i }),
    ).toBeVisible();

    await expect(page.getByText("Fixture Contact")).toBeVisible();
    await expect(
      page.getByRole("link", { name: /contact@baraka-fixture\.invalid/i }),
    ).toBeVisible();

    await page.screenshot({
      path: evidence("admin-project-pending-detail"),
      fullPage: true,
    });

    if (isMobile) return;

    const badge = page.locator(".flex.items-center.gap-3 span").first();
    const statusText = (await badge.textContent())?.trim().toUpperCase() ?? "";

    if (statusText === "PENDING") {
      await page.getByRole("button", { name: /approve/i }).click();
      await expect(
        page.locator("span", { hasText: /approved/i }).first(),
      ).toBeVisible();
    }

    await expect(
      page.locator("span", { hasText: /approved/i }).first(),
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
      page.getByRole("heading", { name: /delivery tracking dashboard/i }),
    ).toBeVisible();

    await expect(
      page.getByRole("heading", { name: /interested builders/i }),
    ).toBeVisible();

    await page.screenshot({
      path: evidence("admin-project-approved-detail"),
      fullPage: true,
    });
  });

  test("admin dashboard links to profiles flagged by checks", async ({
    page,
  }) => {
    await page.goto("/admin");
    await expect(
      page.getByText("Profiles flagged by checks", { exact: true }),
    ).toBeVisible();
    await expect(
      page.getByRole("link", { name: /view flagged profiles/i }),
    ).toBeVisible();

    await page.screenshot({
      path: evidence("admin-dashboard-review-queues"),
      fullPage: true,
    });
  });
});
