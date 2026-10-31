import { expect, test, type Browser, type Page } from "@playwright/test";
import { mkdirSync } from "node:fs";
import { FIXTURE_ENVIRONMENT } from "./fixture-env";
import { guardFeedbackBrowserContext, closeFeedbackBrowserContext, feedbackApiRequest, submitFeedbackAdminSave } from "../scripts/cloudflare/feedback-browser-guard.mjs";

const EVIDENCE_DIR = "test-results/evidence";
mkdirSync(EVIDENCE_DIR, { recursive: true });

const evidence = (name: string) =>
  `${EVIDENCE_DIR}/${test.info().project.name}-feedback-${name}.png`;

const studentToken = process.env.PLAYWRIGHT_FEEDBACK_STUDENT_TOKEN;
const adminToken = process.env.PLAYWRIGHT_AGENT_TOKEN;

// Bearer headers must never be retained in Playwright request traces.
test.use({ trace: "off" });

// The widget is on every page. Start on one no flag redirects: the guard
// aborts every 3xx, and /dashboard selects a space when spaces is ON.
const START_PAGE = "/dashboard/feedback";

/**
 * The floating launcher. The spaces shell has none (the account menu opens the
 * form), so there the page's own "Send feedback" button opens it. That button
 * is static markup the widget listens for once it hydrates (client:idle), so
 * wait for every island first.
 */
async function openFeedback(page: Page) {
  const inSpaces = (await page.locator(".spaces-shell").count()) > 0;
  if (inSpaces) await expect(page.locator("astro-island[ssr]")).toHaveCount(0);
  await page.getByRole("button", { name: inSpaces ? "Send feedback" : "Feedback", exact: true }).click();
}

async function contextFor(browser: Browser, token: string, baseURL: string | undefined) {
  if (!baseURL) throw new Error("Feedback verification requires an explicit base URL.");
  const context = await browser.newContext({
    ...test.info().project.use,
    baseURL,
    extraHTTPHeaders: { Authorization: `Bearer ${token}` },
    serviceWorkers: "block",
  });
  await guardFeedbackBrowserContext(context, baseURL);
  return context;
}

test.describe("student feedback loop", () => {
  // Writes feedback rows, so it runs only against isolated agent-* stacks.
  test.skip(
    !FIXTURE_ENVIRONMENT,
    "Writes are restricted to isolated agent environments."
  );
  test.beforeAll(() => {
    expect(Boolean(studentToken), "Isolated preview requires a run-scoped feedback student token").toBe(true);
    expect(Boolean(adminToken), "Isolated preview requires an admin token").toBe(true);
  });

  test("a student sends a marked-up screenshot and sees the team's reply", async ({
    browser,
    baseURL,
  }) => {
    const note = `Feedback e2e ${test.info().project.name} ${Date.now()}`;

    // ── Student sends feedback with a captured, marked-up screenshot ──
    const student = await contextFor(browser, studentToken!, baseURL);
    const page = await student.newPage();
    await page.goto(START_PAGE);
    await openFeedback(page);
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

    const submission = page.waitForResponse((response) =>
      new URL(response.url()).pathname === "/api/feedback" && response.request().method() === "POST"
    );
    await panel.getByRole("button", { name: "Send feedback" }).click();
    expect((await submission).status(), "Feedback submission must succeed before checking the receipt").toBe(201);
    await expect(panel.getByText("Thank you, it's with the team.")).toBeVisible();

    await panel.getByRole("link", { name: "See your feedback" }).click();
    const entry = page.getByTestId("feedback-history").locator("li", { hasText: note });
    await expect(entry).toContainText("Received");
    await expect(entry.getByRole("img", { name: "Screenshot 1" })).toBeVisible();

    // ── An admin replies from the console ──
    const admin = await contextFor(browser, adminToken!, baseURL);
    const adminPage = await admin.newPage();
    const listResponse = await feedbackApiRequest(adminPage.request, baseURL!, "/api/admin/feedback?status=NEW&kind=BUG");
    expect(listResponse.ok()).toBe(true);
    const { items } = (await listResponse.json()) as {
      items: Array<{ id: string; message: string; attachments: unknown[] }>;
    };
    const item = items.find((candidate) => candidate.message === note);
    expect(item?.attachments).toHaveLength(1);

    await adminPage.goto(`/admin/feedback/${item!.id}`);
    await adminPage.getByLabel("Status").selectOption("RESOLVED");
    await adminPage.getByLabel(/Reply to/).fill("Thanks! Fixed in the latest release.");
    await expect(adminPage.getByLabel(/Reply to/)).toHaveValue("Thanks! Fixed in the latest release.");
    const submittedReplyMatches = adminPage.waitForRequest(request =>
      request.url() === adminPage.url() && request.method() === "POST"
    ).then(request => new URLSearchParams(request.postData() ?? "").get("response") === "Thanks! Fixed in the latest release.");
    await submitFeedbackAdminSave(adminPage, baseURL!, () => adminPage.getByRole("button", { name: "Save" }).click());
    expect(await submittedReplyMatches, "Submitted fictional reply must match the filled form").toBe(true);
    await expect(adminPage.getByText("Saved.")).toBeVisible();
    await adminPage.reload();
    await expect(adminPage.getByLabel("Status")).toHaveValue("RESOLVED");
    await expect(adminPage.getByLabel(/Reply to/)).toHaveValue("Thanks! Fixed in the latest release.");

    // ── The student sees the outcome ──
    await page.reload();
    await expect(entry).toContainText("Done");
    await expect(entry).toContainText("Thanks! Fixed in the latest release.");
    await page.screenshot({ path: evidence("replied"), fullPage: true });

    await closeFeedbackBrowserContext(student);
    await closeFeedbackBrowserContext(admin);
  });

  test("a theme carries every student on it from planned to done", async ({ browser, baseURL }) => {
    const stamp = `${test.info().project.name} ${Date.now()}`;
    const note = `Theme e2e note ${stamp}`;

    const student = await contextFor(browser, studentToken!, baseURL);
    const page = await student.newPage();
    await page.goto(START_PAGE);
    await openFeedback(page);
    const panel = page.getByTestId("feedback-panel");
    await panel.getByText("Idea").click();
    await panel.getByLabel("Your feedback").fill(note);
    const submission = page.waitForResponse((response) =>
      new URL(response.url()).pathname === "/api/feedback" && response.request().method() === "POST"
    );
    await panel.getByRole("button", { name: "Send feedback" }).click();
    expect((await submission).status(), "Feedback submission must succeed before checking the receipt").toBe(201);
    await expect(panel.getByText("Thank you, it's with the team.")).toBeVisible();

    // ── Triage, the way the agent does it: theme, attach, plan ──
    const admin = await contextFor(browser, adminToken!, baseURL);
    const api = admin.request;
    // Browser-session tokens must pass the same-origin guard on admin writes;
    // the request API sends no Origin of its own.
    const headers = { Origin: new URL(baseURL!).origin };
    const untriaged = await feedbackApiRequest(api, baseURL!, "/api/admin/feedback?untriaged=1&kind=IDEA");
    const { items } = (await untriaged.json()) as { items: Array<{ id: string; message: string }> };
    const noteId = items.find((item) => item.message === note)!.id;

    const created = await feedbackApiRequest(api, baseURL!, "/api/admin/feedback/themes", {
      method: "POST",
      headers,
      data: { title: `Theme e2e ${stamp}`, kind: "IDEA", change: "ADD" },
    });
    expect(created.status()).toBe(201);
    const theme = (await created.json()) as { id: string };
    expect((await feedbackApiRequest(api, baseURL!, `/api/admin/feedback/${noteId}`, { method: "PATCH", headers, data: { themeId: theme.id } })).ok()).toBe(true);
    expect(
      (
        await feedbackApiRequest(api, baseURL!, `/api/admin/feedback/themes/${theme.id}`, {
          method: "PATCH",
          headers,
          data: { status: "PLANNED", issueUrl: "https://github.com/Tembo-Tech-Ventures/ttv-website/issues/1" },
        })
      ).ok()
    ).toBe(true);

    await page.goto("/dashboard/feedback");
    const entry = page.getByTestId("feedback-history").locator("li", { hasText: note });
    await expect(entry).toContainText("Planned");
    await expect(entry.getByRole("link", { name: "Follow the plan" })).toBeVisible();

    // ── Shipping from the console answers the student ──
    const adminPage = await admin.newPage();
    await adminPage.goto(`/admin/feedback/themes/${theme.id}`);
    await expect(adminPage.getByText(note)).toBeVisible();
    await adminPage.getByLabel("Status").selectOption("SHIPPED");
    await adminPage.getByLabel(/Message to students/).fill("This shipped. Thank you for asking!");
    await submitFeedbackAdminSave(adminPage, baseURL!, () => adminPage.getByRole("button", { name: "Save" }).click());
    await expect(adminPage.getByText("Saved.")).toBeVisible();
    await adminPage.reload();
    await expect(adminPage.getByLabel("Status")).toHaveValue("SHIPPED");

    await page.reload();
    await expect(entry).toContainText("Done");
    await expect(entry).toContainText("This shipped. Thank you for asking!");
    await expect(entry.getByRole("link", { name: "Follow the plan" })).toHaveCount(0);
    await page.screenshot({ path: evidence("theme-shipped"), fullPage: true });

    await closeFeedbackBrowserContext(student);
    await closeFeedbackBrowserContext(admin);
  });

  test("signed-out visitors cannot open feedback screenshots", async ({ browser, baseURL }) => {
    const admin = await contextFor(browser, adminToken!, baseURL);
    const response = await feedbackApiRequest(admin.request, baseURL!, "/api/admin/feedback?status=all&limit=50");
    const { items } = (await response.json()) as {
      items: Array<{ attachments: Array<{ url: string }>; submittedBy: { id: string } }>;
    };
    const withImage = items.find((item) => item.attachments.length > 0);
    test.skip(!withImage, "No feedback screenshot exists yet in this environment.");

    const anonymous = await browser.newContext({ baseURL });
    const anonymousResponse = await anonymous.request.get(withImage!.attachments[0].url);
    expect(anonymousResponse.status()).toBe(401);
    await closeFeedbackBrowserContext(anonymous);
    await closeFeedbackBrowserContext(admin);
  });
});
