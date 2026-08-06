import { expect, test, type Locator } from "@playwright/test";
import { mkdirSync } from "node:fs";
import { FIXTURE_ENVIRONMENT } from "./fixture-env";

const PROGRAM_ID = "ttv-fixture-program-cohort-04";
const PROGRAM_PATH = `/admin/programs/${PROGRAM_ID}`;
const EVIDENCE_DIR = "test-results/evidence";
mkdirSync(EVIDENCE_DIR, { recursive: true });

const evidence = (name: string) =>
  `${EVIDENCE_DIR}/${test.info().project.name}-${name}.png`;

test.describe("admin cohort management", () => {
  const token = process.env.PLAYWRIGHT_AGENT_TOKEN;
  test.skip(
    !token,
    "No agent bearer token is configured for this environment."
  );
  test.skip(
    !FIXTURE_ENVIRONMENT,
    "Cohort-management mutations run only against isolated agent fixtures."
  );
  test.use({
    extraHTTPHeaders: token ? { Authorization: `Bearer ${token}` } : {},
  });

  test("direct enrollment and atomic bulk actions converge", async ({
    page,
    request,
  }) => {
    const viewport =
      test.info().project.name === "mobile-chromium" ? "mobile" : "desktop";
    const viewportLabel =
      viewport.charAt(0).toUpperCase() + viewport.slice(1);
    const fixture = (key: string, label: string) => ({
      key,
      name: `Cohort ${viewportLabel} ${label}`,
      email: `cohort-${viewport}-${key}@invalid.ttv`,
      applicationId: `ttv-fixture-app-cohort-${viewport}-${key}`,
    });
    const current = fixture("current", "Current Learner");
    const alumni = fixture("alumni", "Historical Alumni");
    const pending = fixture("pending", "Pending Learner");
    const audit = fixture("audit", "Audit Learner");
    const approved = fixture("approved", "Approved Learner");

    const rosterRow = (name: string) =>
      page.locator("[data-roster-application]", { hasText: name });
    const rosterStatus = async (name: string) =>
      (await rosterRow(name).getAttribute("data-application-status")) ?? "";
    const expectRosterStatus = async (name: string, status: string) => {
      const row = rosterRow(name);
      await expect(row).toBeVisible();
      await expect(row).toHaveAttribute("data-application-status", status);
    };
    const clickWithConfirmation = async (
      button: Locator,
      expectedMessage: RegExp
    ) => {
      await button.evaluate((el) =>
        el.scrollIntoView({ block: "center", inline: "nearest" })
      );
      await expect(button).toBeVisible();
      const dialogPromise = page.waitForEvent("dialog");
      const clickPromise = button.click();
      const dialog = await dialogPromise;
      expect(dialog.message()).toMatch(expectedMessage);
      await dialog.accept();
      await clickPromise;
    };
    const enrollIfAvailable = async (
      learner: typeof current,
      status: "APPROVED" | "COMPLETED"
    ) => {
      const userSelect = page.locator("#enrollmentUserId");
      const option = userSelect.locator("option", {
        hasText: `${learner.name} (${learner.email})`,
      });

      if ((await option.count()) > 0) {
        await userSelect.selectOption({
          label: `${learner.name} (${learner.email})`,
        });
        await page.locator("#enrollmentStatus").selectOption(status);
        if (status === "COMPLETED") {
          await page.locator("#enrollmentCompletionDate").fill("2025-04-12");
        }
        await clickWithConfirmation(
          page.getByRole("button", { name: "Enroll user" }),
          /certificates and builder portfolios unlock immediately/i
        );
      }

      await expect(rosterRow(learner.name)).toContainText(learner.email);
      await expect(rosterRow(learner.name)).toContainText("Admin enrollment");
      await expectRosterStatus(learner.name, status);
      const certificateLink = rosterRow(learner.name).getByRole("link", {
        name: "View certificate",
      });
      if (status === "COMPLETED") {
        await expect(certificateLink).toBeVisible();
      } else {
        await expect(certificateLink).toHaveCount(0);
      }
    };

    await page.goto(PROGRAM_PATH);
    await expect(
      page.getByRole("heading", { name: "Cohort roster" })
    ).toBeVisible();
    await expect(page.getByText(/select at most 90 applications/i)).toBeVisible();

    await enrollIfAvailable(current, "APPROVED");
    await enrollIfAvailable(alumni, "COMPLETED");

    // A mixed valid/invalid selection must be rejected by the server without
    // changing the otherwise-eligible PENDING row.
    if ((await rosterStatus(pending.name)) === "PENDING") {
      const invalidBody = new URLSearchParams([
        ["action", "bulk-approve"],
        ["applicationIds", pending.applicationId],
        ["applicationIds", "ttv-fixture-app-preview"],
      ]);
      const invalidResponse = await request.post(PROGRAM_PATH, {
        headers: {
          "content-type": "application/x-www-form-urlencoded",
          Origin: new URL(page.url()).origin,
        },
        data: invalidBody.toString(),
      });

      expect(invalidResponse.status()).toBe(400);
      expect(await invalidResponse.text()).toContain(
        "cannot include a COMPLETED application"
      );
      await page.reload();
      await expectRosterStatus(pending.name, "PENDING");
    }

    const approvalCandidates = [pending, audit];
    const eligibleForApproval = [];
    for (const learner of approvalCandidates) {
      const status = await rosterStatus(learner.name);
      if (status === "PENDING" || status === "AUDIT") {
        eligibleForApproval.push(learner);
        await rosterRow(learner.name).getByRole("checkbox").check();
      }
    }

    if (eligibleForApproval.length > 0) {
      await clickWithConfirmation(
        page.getByRole("button", { name: "Approve selected" }),
        /eligible PENDING or AUDIT applications/i
      );
    }
    await expectRosterStatus(pending.name, "APPROVED");
    await expectRosterStatus(audit.name, "APPROVED");

    const completionCandidates = [pending, audit, approved];
    const eligibleForCompletion = [];
    for (const learner of completionCandidates) {
      if ((await rosterStatus(learner.name)) === "APPROVED") {
        eligibleForCompletion.push(learner);
        await rosterRow(learner.name).getByRole("checkbox").check();
      }
    }

    if (eligibleForCompletion.length > 0) {
      await page
        .locator('[data-bulk-form] input[name="completionDate"]')
        .fill("2025-04-12");
      await clickWithConfirmation(
        page.getByRole("button", { name: "Complete selected" }),
        /certificates and builder portfolios/i
      );
    }

    await expectRosterStatus(pending.name, "COMPLETED");
    await expectRosterStatus(audit.name, "COMPLETED");
    await expectRosterStatus(approved.name, "COMPLETED");
    await expectRosterStatus(current.name, "APPROVED");
    await expectRosterStatus(alumni.name, "COMPLETED");
    await expect(
      rosterRow(current.name).getByRole("link", { name: "View certificate" })
    ).toHaveCount(0);
    await expect(
      rosterRow(alumni.name).getByRole("link", { name: "View certificate" })
    ).toBeVisible();

    await rosterRow(alumni.name)
      .getByRole("link", { name: "Application" })
      .click();
    await expect(
      page.getByRole("link", { name: "View certificate" })
    ).toBeVisible();
    await expect(page.getByLabel("Completion date")).toHaveCount(0);
    await page.goto(PROGRAM_PATH);

    await page.screenshot({
      path: evidence("admin-cohort-management-complete"),
      fullPage: true,
    });
  });

  test("self-application, cohort editing, and staff boundaries converge", async ({
    page,
    request,
  }) => {
    const viewport =
      test.info().project.name === "mobile-chromium" ? "mobile" : "desktop";
    const viewportLabel =
      viewport.charAt(0).toUpperCase() + viewport.slice(1);
    const retry = Math.min(test.info().retry, 2);
    const programId =
      `ttv-fixture-program-self-apply-${viewport}-${retry}`;
    const programName =
      `Open Cohort ${viewportLabel} Applications ${retry + 1}`;
    const programPath = `/admin/programs/${programId}`;
    const staffUserId = `ttv-fixture-user-staff-${viewport}`;
    const staffName = `Cohort ${viewportLabel} Staff`;
    const crossCohortRoleId =
      `ttv-fixture-role-cross-cohort-${viewport}`;

    await page.goto("/dashboard/apply");
    const origin = new URL(page.url()).origin;
    const postForm = (
      path: string,
      entries: [string, string][]
    ) =>
      request.post(path, {
        headers: {
          "content-type": "application/x-www-form-urlencoded",
          Origin: origin,
        },
        data: new URLSearchParams(entries).toString(),
      });

    await expect(
      page.getByRole("heading", { name: "Apply to a Cohort" })
    ).toBeVisible();
    const applicationCard = page.locator(
      `[data-cohort-id="${programId}"]`
    );
    await expect(applicationCard).toContainText(programName);
    await expect(
      page.locator(
        '[data-cohort-id="ttv-fixture-program-applications-closed"]'
      )
    ).toHaveCount(0);

    await applicationCard.getByRole("button", { name: "Apply" }).click();
    await expect(page).toHaveURL(/notice=application-submitted/);
    await expect(
      page.getByText("Your cohort application was submitted.")
    ).toBeVisible();
    await expect(page.locator(`[data-cohort-id="${programId}"]`)).toHaveCount(
      0
    );

    const duplicateResponse = await postForm("/dashboard/apply", [
      ["programId", programId],
    ]);
    expect(duplicateResponse.status()).toBe(400);
    expect(await duplicateResponse.text()).toContain(
      "already applied to that cohort"
    );

    const closedResponse = await postForm("/dashboard/apply", [
      ["programId", "ttv-fixture-program-applications-closed"],
    ]);
    expect(closedResponse.status()).toBe(400);
    expect(await closedResponse.text()).toContain(
      "Applications for that cohort are closed"
    );

    const unknownResponse = await postForm("/dashboard/apply", [
      ["programId", "ttv-fixture-program-does-not-exist"],
    ]);
    expect(unknownResponse.status()).toBe(400);
    const unknownBody = await unknownResponse.text();
    expect(unknownBody).toContain("That cohort does not exist");
    expect(unknownBody).not.toMatch(/SQLITE|programApplication/i);

    const staleCurriculumResponse = await postForm(programPath, [
      ["action", "update-program"],
      ["name", programName],
      ["description", "Open self-application fixture"],
      ["curriculumId", "ttv-fixture-curriculum-stale"],
      ["startDate", "2026-09-01"],
      ["endDate", "2026-12-01"],
      ["applicationsOpen", "on"],
    ]);
    expect(staleCurriculumResponse.status()).toBe(400);
    const staleCurriculumBody = await staleCurriculumResponse.text();
    expect(staleCurriculumBody).toContain(
      "That curriculum no longer exists"
    );
    expect(staleCurriculumBody).toContain('id="curriculum-error"');

    await page.goto(programPath);
    const detailsForm = page.locator("[data-cohort-details-form]");
    await expect(detailsForm).toBeVisible();
    await detailsForm.getByLabel("Name *").fill(`  ${programName}  `);
    await detailsForm
      .getByLabel("Description *")
      .fill("  Cohort applications managed in preview.  ");
    await detailsForm
      .getByLabel("Curriculum *")
      .selectOption("ttv-fixture-curriculum");
    await detailsForm.getByLabel("Start date").fill("2026-09-01");
    await detailsForm.getByLabel("End date").fill("2026-12-01");
    await detailsForm.getByLabel("Applications open").uncheck();
    await detailsForm.getByRole("button", { name: "Save Changes" }).click();
    await expect(page.getByText("Cohort details updated.")).toBeVisible();
    await expect(page.getByLabel("Name *")).toHaveValue(programName);
    await expect(page.getByLabel("Applications open")).not.toBeChecked();

    await page.getByLabel("Applications open").check();
    await page.getByRole("button", { name: "Save Changes" }).click();
    await expect(page.getByLabel("Applications open")).toBeChecked();

    await page.locator("#staffUserId").selectOption(staffUserId);
    await page.locator("#roleName").selectOption("TA");
    await page.getByRole("button", { name: "Add Staff" }).click();
    await expect(page.getByText("Cohort staff role added.")).toBeVisible();
    const staffRow = page.locator("tbody tr", { hasText: staffName });
    await expect(staffRow).toContainText("TA");

    const duplicateStaffResponse = await postForm(programPath, [
      ["action", "add-role"],
      ["userId", staffUserId],
      ["roleName", "TA"],
    ]);
    expect(duplicateStaffResponse.status()).toBe(400);
    expect(await duplicateStaffResponse.text()).toContain(
      "already has this role in the cohort"
    );

    const forgedStaffRoleResponse = await postForm(programPath, [
      ["action", "add-role"],
      ["userId", staffUserId],
      ["roleName", "ADMIN"],
    ]);
    expect(forgedStaffRoleResponse.status()).toBe(400);
    expect(await forgedStaffRoleResponse.text()).toContain(
      "Choose Instructor or TA"
    );

    const crossCohortResponse = await postForm(programPath, [
      ["action", "remove-role"],
      ["roleId", crossCohortRoleId],
    ]);
    expect(crossCohortResponse.status()).toBe(400);
    expect(await crossCohortResponse.text()).toContain(
      "does not belong to this cohort"
    );

    const dialogPromise = page.waitForEvent("dialog");
    const removePromise = staffRow.getByRole("button", { name: "Remove" }).click();
    const dialog = await dialogPromise;
    expect(dialog.message()).toMatch(/remove this staff member from the cohort/i);
    await dialog.accept();
    await removePromise;
    await expect(page.getByText("Cohort staff role removed.")).toBeVisible();
    await expect(page.locator("tbody tr", { hasText: staffName })).toHaveCount(0);

    await page.screenshot({
      path: evidence("cohort-application-edit-staff-complete"),
      fullPage: true,
    });
  });
});
