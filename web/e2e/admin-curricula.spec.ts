import { expect, test, type Page } from "@playwright/test";
import { mkdirSync } from "node:fs";
import { FIXTURE_ENVIRONMENT } from "./fixture-env";

const EVIDENCE_DIR = "test-results/evidence";
mkdirSync(EVIDENCE_DIR, { recursive: true });

const evidence = (name: string) =>
  `${EVIDENCE_DIR}/${test.info().project.name}-${name}.png`;

async function navigateToCurricula(page: Page, viewportWidth: number) {
  await page.goto("/admin");
  if (viewportWidth < 1024) {
    await page.getByRole("button", { name: "Open navigation" }).click();
  }
  await page
    .getByRole("link", { name: "Curricula", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "Curricula", exact: true })
  ).toBeVisible();
}

test.describe("admin curriculum management", () => {
  const token = process.env.PLAYWRIGHT_AGENT_TOKEN;
  test.skip(
    !token,
    "No agent bearer token is configured for this environment."
  );
  test.skip(
    !FIXTURE_ENVIRONMENT,
    "Curriculum CRUD is confined to isolated agent environments."
  );
  test.use({
    extraHTTPHeaders: token ? { Authorization: `Bearer ${token}` } : {},
  });

  test("creates, edits, shows usage, and deletes an unused curriculum", async ({
    page,
    viewport,
  }) => {
    const viewportWidth = viewport?.width ?? 1280;
    const unique = `${test.info().project.name}-${Date.now()}`;
    const initialTitle = `Curriculum E2E ${unique}`;
    const updatedTitle = `${initialTitle} Updated`;
    let editPath: string | undefined;

    try {
      await navigateToCurricula(page, viewportWidth);
      await page.getByRole("link", { name: "New Curriculum" }).click();

      await page.getByLabel(/^Title/).fill(`  ${initialTitle}  `);
      await page
        .getByLabel(/^Description/)
        .fill("  Curriculum created by the isolated admin journey.  ");
      await page
        .getByRole("button", { name: "Create Curriculum" })
        .click();

      await expect(
        page.getByRole("heading", { name: "Edit Curriculum" })
      ).toBeVisible();
      await expect(page.getByRole("status")).toContainText(
        "Curriculum created."
      );
      editPath = new URL(page.url()).pathname;
      await expect(page.getByLabel(/^Title/)).toHaveValue(initialTitle);
      await expect(page.getByLabel(/^Description/)).toHaveValue(
        "Curriculum created by the isolated admin journey."
      );

      await page.getByLabel(/^Title/).fill(`  ${updatedTitle}  `);
      await page
        .getByLabel(/^Description/)
        .fill("  Updated curriculum description.  ");
      await page.getByRole("button", { name: "Save Changes" }).click();

      await expect(page.getByRole("status")).toContainText(
        "Curriculum changes saved."
      );
      await expect(page.getByLabel(/^Title/)).toHaveValue(updatedTitle);
      await expect(page.getByLabel(/^Description/)).toHaveValue(
        "Updated curriculum description."
      );
      await expect(
        page.getByText("No programs or cohorts use this curriculum yet.")
      ).toBeVisible();

      await page.getByRole("link", { name: "Back to Curricula" }).click();
      const curriculumCard = page.locator("article").filter({
        hasText: updatedTitle,
      });
      await expect(curriculumCard).toBeVisible();
      await expect(curriculumCard.getByText("Not used yet")).toBeVisible();
      await curriculumCard
        .getByRole("link", { name: `Edit ${updatedTitle}` })
        .click();

      page.once("dialog", (dialog) => dialog.accept());
      await page
        .getByRole("button", { name: "Delete Curriculum" })
        .click();

      await expect(page.getByRole("status")).toContainText(
        "Curriculum deleted."
      );
      editPath = undefined;
      await expect(page.getByText(updatedTitle)).toHaveCount(0);
      await page.screenshot({
        path: evidence("admin-curriculum-happy-path"),
        fullPage: true,
      });
    } finally {
      if (editPath) {
        await page.goto(editPath);
        const deleteButton = page.getByRole("button", {
          name: "Delete Curriculum",
        });
        if (await deleteButton.isVisible().catch(() => false)) {
          page.once("dialog", (dialog) => dialog.accept());
          await deleteButton.click();
        }
      }
    }
  });

  test("shows inline validation errors without losing submitted values", async ({
    page,
  }) => {
    await page.goto("/admin/curricula/new");
    const submittedDescription = "  Keep this submitted description.  ";

    await page.getByLabel(/^Title/).fill("   ");
    await page.getByLabel(/^Description/).fill(submittedDescription);
    await page
      .getByRole("button", { name: "Create Curriculum" })
      .click();

    await expect(page.getByText("Enter a curriculum title.")).toBeVisible();
    await expect(page.getByLabel(/^Title/)).toHaveValue("   ");
    await expect(page.getByLabel(/^Description/)).toHaveValue(
      submittedDescription
    );
    await page.screenshot({
      path: evidence("admin-curriculum-validation"),
      fullPage: true,
    });
  });

  test("rejects deletion of a referenced curriculum without deleting its program", async ({
    page,
  }) => {
    const response = await page.request.post(
      "/admin/curricula/ttv-fixture-curriculum",
      { form: { action: "delete" } }
    );

    expect(response.ok()).toBe(true);
    const responseBody = await response.text();
    expect(responseBody).toContain(
      "This curriculum is used by one or more programs and cannot be deleted."
    );
    expect(responseBody).toContain("Cohort 04");

    await page.goto("/admin/curricula/ttv-fixture-curriculum");
    await expect(
      page.getByRole("heading", { name: "Edit Curriculum" })
    ).toBeVisible();
    const cohortLink = page.getByRole("link", {
      name: "Cohort 04",
      exact: true,
    });
    await expect(cohortLink).toBeVisible();
    await expect(
      page.getByText(
        "This curriculum cannot be deleted while a program or cohort references it."
      )
    ).toBeVisible();
    await expect(
      page.getByRole("button", { name: "Delete Curriculum" })
    ).toHaveCount(0);
    await page.screenshot({
      path: evidence("admin-curriculum-referenced"),
      fullPage: true,
    });

    await cohortLink.click();
    await expect(
      page.getByRole("heading", { name: "Program Details" })
    ).toBeVisible();
    await expect(page.getByLabel(/^Name/)).toHaveValue("Cohort 04");
  });
});
