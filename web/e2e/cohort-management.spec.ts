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
      (
        await rosterRow(name)
          .locator("span")
          .filter({ hasText: /^(pending|approved|rejected|audit|completed)$/i })
          .first()
          .textContent()
      )
        ?.trim()
        .toUpperCase() ?? "";
    const expectRosterStatus = async (name: string, status: string) => {
      const row = rosterRow(name);
      await expect(row).toBeVisible();
      await expect(
        row
          .locator("span")
          .filter({ hasText: new RegExp(`^${status}$`, "i") })
          .first()
      ).toBeVisible();
    };
    const clickWithConfirmation = async (
      button: Locator,
      expectedMessage: RegExp
    ) => {
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
        await clickWithConfirmation(
          page.getByRole("button", { name: "Enroll user" }),
          /certificates and builder portfolios unlock immediately/i
        );
      }

      await expect(rosterRow(learner.name)).toContainText(learner.email);
      await expect(rosterRow(learner.name)).toContainText("Admin enrollment");
      await expectRosterStatus(learner.name, status);
    };

    await page.goto(PROGRAM_PATH);
    await expect(
      page.getByRole("heading", { name: "Cohort roster" })
    ).toBeVisible();

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
        headers: { "content-type": "application/x-www-form-urlencoded" },
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

    await page.screenshot({
      path: evidence("admin-cohort-management-complete"),
      fullPage: true,
    });
  });
});
