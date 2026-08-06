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

      const titleInput = page.locator('input[name="title"]');
      const descriptionInput = page.locator('textarea[name="description"]');
      await titleInput.fill(`  ${initialTitle}  `);
      await descriptionInput.fill(
        "  Curriculum created by the isolated admin journey.  "
      );
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
      await expect(titleInput).toHaveValue(initialTitle);
      await expect(descriptionInput).toHaveValue(
        "Curriculum created by the isolated admin journey."
      );

      await titleInput.fill(`  ${updatedTitle}  `);
      await descriptionInput.fill("  Updated curriculum description.  ");
      await page.getByRole("button", { name: "Save Changes" }).click();

      await expect(page.getByRole("status")).toContainText(
        "Curriculum changes saved."
      );
      await expect(titleInput).toHaveValue(updatedTitle);
      await expect(descriptionInput).toHaveValue(
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
    const titleInput = page.locator('input[name="title"]');
    const descriptionInput = page.locator('textarea[name="description"]');

    await titleInput.fill("   ");
    await descriptionInput.fill(submittedDescription);
    await page
      .getByRole("button", { name: "Create Curriculum" })
      .click();

    await expect(page.getByText("Enter a curriculum title.")).toBeVisible();
    await expect(titleInput).toHaveValue("   ");
    await expect(descriptionInput).toHaveValue(submittedDescription);
    await page.screenshot({
      path: evidence("admin-curriculum-validation"),
      fullPage: true,
    });
  });

  test("rejects deletion of a referenced curriculum without deleting its program", async ({
    page,
  }) => {
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

    const deleteResponse = await page.evaluate(async () => {
      const response = await fetch(window.location.pathname, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({ action: "delete" }),
      });
      return { ok: response.ok, body: await response.text() };
    });
    expect(deleteResponse.ok).toBe(true);
    expect(deleteResponse.body).toContain(
      "This curriculum is used by one or more programs and cannot be deleted."
    );
    await page.reload();
    await expect(cohortLink).toBeVisible();
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

  test("validates cohort creation and persists unchecked cohorts closed", async ({
    page,
  }) => {
    const cohortName = `Cohort E2E ${test.info().project.name}-${Date.now()}`;
    const submittedDescription = "  Preserved cohort description.  ";

    await page.goto("/admin/programs");
    await expect(
      page.getByRole("heading", { name: "Cohorts", exact: true })
    ).toBeVisible();
    await page.getByRole("link", { name: "New Cohort" }).click();
    await expect(
      page.getByRole("heading", { name: "Create Cohort", exact: true })
    ).toBeVisible();

    const nameInput = page.locator('input[name="name"]');
    const descriptionInput = page.locator('textarea[name="description"]');
    const applicationsOpen = page.getByRole("checkbox", {
      name: "Applications open",
    });
    await expect(applicationsOpen).not.toBeChecked();
    await nameInput.fill("   ");
    await descriptionInput.fill(submittedDescription);
    await page
      .locator('select[name="curriculumId"]')
      .selectOption("ttv-fixture-curriculum");
    await page.getByRole("button", { name: "Create Cohort" }).click();

    await expect(page.getByText("Enter a cohort name.")).toBeVisible();
    await expect(nameInput).toHaveValue("   ");
    await expect(descriptionInput).toHaveValue(submittedDescription);
    await expect(applicationsOpen).not.toBeChecked();

    await nameInput.fill(`  ${cohortName}  `);
    await page.getByRole("button", { name: "Create Cohort" }).click();
    await expect(page).toHaveURL(/\/admin\/programs\/[^/]+$/);

    await page.goto("/admin/programs");
    const cohortRow = page.getByRole("row").filter({ hasText: cohortName });
    await expect(cohortRow).toBeVisible();
    await expect(
      cohortRow.getByText("Closed", { exact: true })
    ).toBeVisible();
    await page.screenshot({
      path: evidence("admin-cohort-create-closed"),
      fullPage: true,
    });
  });
});
