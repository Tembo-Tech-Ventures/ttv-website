import { expect, test, type Browser } from "@playwright/test";
import { mkdirSync } from "node:fs";
import { FIXTURE_ENVIRONMENT } from "./fixture-env";

const EVIDENCE_DIR = "test-results/evidence";
mkdirSync(EVIDENCE_DIR, { recursive: true });

const evidence = (name: string) =>
  `${EVIDENCE_DIR}/${test.info().project.name}-feedback-${name}.png`;

const studentToken = process.env.PLAYWRIGHT_NEW_STUDENT_TOKEN;
const adminToken = process.env.PLAYWRIGHT_AGENT_TOKEN;

async function contextFor(browser: Browser, token: string, baseURL: string | undefined) {
  return browser.newContext({
    ...test.info().project.use,
    baseURL,
    extraHTTPHeaders: { Authorization: `Bearer ${token}` },
  });
}

test.describe("student feedback loop", () => {
  // Writes feedback rows, so it runs only against isolated agent-* stacks.
  test.skip(
    !FIXTURE_ENVIRONMENT || !studentToken || !adminToken,
    "Needs an isolated agent environment with student and admin tokens."
  );

  test("a student sends a marked-up screenshot and sees the team's reply", async ({
    browser,
    baseURL,
  }) => {
    const note = `Feedback e2e ${test.info().project.name} ${Date.now()}`;

    // ── Student sends feedback with a captured, marked-up screenshot ──
    const student = await contextFor(browser, studentToken!, baseURL);
    const page = await student.newPage();
    await page.goto("/dashboard");
    await page.getByRole("button", { name: "Feedback" }).click();
    const panel = page.getByTestId("feedback-panel");
    await expect(panel).toBeVisible();

    await panel.getByText("Something's broken").click();
    await panel.getByLabel("Your feedback").fill(note);
    await panel.getByRole("button", { name: "Capture this page" }).click();

    const markup = page.getByTestId("feedback-markup");
    const canvas = markup.locator("canvas");
    await expect(canvas).toBeVisible({ timeout: 20_000 });
    const box = (await canvas.boundingBox())!;
    await page.mouse.move(box.x + box.width * 0.2, box.y + box.height * 0.2);
    await page.mouse.down();
    await page.mouse.move(box.x + box.width * 0.6, box.y + box.height * 0.5, { steps: 6 });
    await page.mouse.up();
    await markup.getByRole("button", { name: "Done" }).click();
    await expect(panel.getByText("Marked up")).toBeVisible();
    await page.screenshot({ path: evidence("ready") });

    await panel.getByRole("button", { name: "Send feedback" }).click();
    await expect(panel.getByText("Thank you, it's with the team.")).toBeVisible();

    await panel.getByRole("link", { name: "See your feedback" }).click();
    const entry = page.getByTestId("feedback-history").locator("li", { hasText: note });
    await expect(entry).toContainText("Received");
    await expect(entry.getByRole("img", { name: "Screenshot 1" })).toBeVisible();

    // ── An admin replies from the console ──
    const admin = await contextFor(browser, adminToken!, baseURL);
    const adminPage = await admin.newPage();
    const listResponse = await adminPage.request.get("/api/admin/feedback?status=NEW&kind=BUG");
    expect(listResponse.ok()).toBe(true);
    const { items } = (await listResponse.json()) as {
      items: Array<{ id: string; message: string; attachments: unknown[] }>;
    };
    const item = items.find((candidate) => candidate.message === note);
    expect(item?.attachments).toHaveLength(1);

    await adminPage.goto(`/admin/feedback/${item!.id}`);
    await adminPage.getByLabel("Status").selectOption("RESOLVED");
    await adminPage.getByLabel(/Reply to/).fill("Thanks! Fixed in the latest release.");
    await adminPage.getByRole("button", { name: "Save" }).click();
    await expect(adminPage.getByText("Saved.")).toBeVisible();

    // ── The student sees the outcome ──
    await page.reload();
    await expect(entry).toContainText("Done");
    await expect(entry).toContainText("Thanks! Fixed in the latest release.");
    await page.screenshot({ path: evidence("replied"), fullPage: true });

    await student.close();
    await admin.close();
  });

  test("signed-out visitors cannot open feedback screenshots", async ({ browser, baseURL }) => {
    const admin = await contextFor(browser, adminToken!, baseURL);
    const response = await admin.request.get("/api/admin/feedback?status=all&limit=50");
    const { items } = (await response.json()) as {
      items: Array<{ attachments: Array<{ url: string }>; submittedBy: { id: string } }>;
    };
    const withImage = items.find((item) => item.attachments.length > 0);
    test.skip(!withImage, "No feedback screenshot exists yet in this environment.");

    const anonymous = await browser.newContext({ baseURL });
    const anonymousResponse = await anonymous.request.get(withImage!.attachments[0].url);
    expect(anonymousResponse.status()).toBe(401);
    await anonymous.close();
    await admin.close();
  });
});
