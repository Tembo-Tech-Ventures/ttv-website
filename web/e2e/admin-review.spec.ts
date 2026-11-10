import { feedbackApiRequest as safeApiRequest } from "../scripts/cloudflare/feedback-browser-guard.mjs";
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
      page.getByRole("heading", { level: 1, name: "Profiles" }),
    ).toBeVisible();

    const table = page.locator("table");
    await expect(table).toBeVisible();

    await expect(table.getByRole("link", { name: "Amina Fixture" })).toBeVisible();
    await expect(table.getByRole("link", { name: "Kwame Fixture" })).toBeVisible();

    // Each profile in the content check's queue offers only the actions that
    // would change it, each named by the builder it acts on. Listing a draft is
    // the member's own choice, so no admin action publishes it.
    const held = page.getByRole("region", { name: "Held by the content check" });
    await expect(held.getByRole("link", { name: "Kwame Fixture" })).toBeVisible();
    await expect(held.getByRole("button", { name: "Publish Kwame Fixture", exact: true })).toHaveCount(0);
    // A draft isn't on the public website to come off, so it is paused.
    for (const action of ["Pause", "Clear flag"]) {
      await expect(
        held.getByRole("button", { name: `${action} Kwame Fixture`, exact: true }),
      ).toBeVisible();
    }

    const unavailable = page.getByRole("region", {
      name: "Profiles awaiting a completed check",
    });
    await expect(unavailable.getByRole("link", { name: "Amina Fixture" })).toBeVisible();
    await expect(
      unavailable.getByRole("button", { name: "Publish Amina Fixture", exact: true }),
    ).toHaveCount(0);
    for (const action of ["Unpublish", "Clear flag"]) {
      await expect(
        unavailable.getByRole("button", { name: `${action} Amina Fixture`, exact: true }),
      ).toBeVisible();
    }

    await page.screenshot({
      path: evidence("admin-profiles-index"),
      fullPage: true,
    });
  });

  test("profiles index status filter works", async ({ page }) => {
    await page.goto("/admin/profiles?status=PUBLISHED");
    const table = page.locator("table");
    await expect(table.getByRole("link", { name: "Amina Fixture" })).toBeVisible();

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
      await kwameRow.getByRole("link", { name: "Kwame Fixture" }).click();
    }

    await expect(page.getByRole("heading", { level: 1, name: "Kwame Fixture" })).toBeVisible();

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
    // A draft: only the member can list it, so there is nothing to publish here.
    await expect(
      page.getByRole("button", { name: "Publish", exact: true }),
    ).toHaveCount(0);
    await expect(page.getByText("Only the member can list it there.")).toBeVisible();
    await expect(
      page.getByRole("button", { name: "Pause", exact: true }),
    ).toBeVisible();
    await expect(
      page.getByRole("button", { name: "Clear flag" }),
    ).toBeVisible();
  });

  test("admin can suspend and restore a published post", async ({
    page,
    viewport,
    baseURL,
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
        await safeApiRequest(page.request, baseURL!, "/blog/amina-preview/debugging-at-the-edge")
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
        await safeApiRequest(page.request, baseURL!, "/blog/amina-preview/debugging-at-the-edge")
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
      await row.getByRole("link", { name: "Clinic booking website" }).click();
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

    // The status chip under the title carries the stored value; it reads "In review" and "Accepted".
    const main = page.locator("main");
    const status = main.locator("[data-page-header] [data-status]");
    if ((await status.getAttribute("data-status")) === "PENDING") {
      await main.getByRole("button", { name: "Accept", exact: true }).click();
      await expect(page.getByRole("status").filter({ hasText: "Project accepted" })).toBeVisible();
    }

    await expect(status).toHaveAttribute("data-status", "APPROVED");
    await expect(status).toHaveText("Accepted");

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
      await row.getByRole("link", { name: "Delivery tracking dashboard" }).click();
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
