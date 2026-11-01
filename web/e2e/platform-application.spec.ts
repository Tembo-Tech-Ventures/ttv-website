import { mkdirSync } from "node:fs";
import { expect, test, type BrowserContext, type Page } from "@playwright/test";
import { runAxe } from "./platform-axe";
import { personaSession, signIn, type PersonaSession } from "./platform-personas";

/**
 * F-1 (QA1-01, QA1-02, QA1-04): a member's cohort application, as plain
 * answers. Members never see or type JSON. An application that carries
 * questions (the old stack's imported ones) shows them as labelled fields that
 * save back into it, and a rejected form keeps what was typed. One that
 * carries none (every self-application) has no edit step, only a truthful
 * read-only state. The page after applying says "submitted" and nothing
 * contradicts it. Admins keep their read-only application view.
 *
 * Runs against the local seed only (platform-personas.local.sql), with the
 * spaces flag on or off: the same assertions hold in both frames, and each
 * test records which one it saw.
 * - Njeri, a member whose pending application carries questions;
 * - Brian, a member with no application, who applies here (re-seed to rerun);
 * - Mercy, whose pending application staff approve while she edits it (re-seed to rerun);
 * - Wanjiku, the cohort persona, whose approved application has no answers;
 * - Amina, staff, for the admin view.
 * They sign in like the community persona, with its cookie and secret.
 */

const EVIDENCE_DIR = "test-results/evidence/platform-application";
mkdirSync(EVIDENCE_DIR, { recursive: true });

const APPLICANT_APPLICATION = "ttv-local-persona-app-applicant";
const REVIEWEE_APPLICATION = "ttv-local-persona-app-reviewee";
const STUDENT_APPLICATION = "ttv-local-persona-app-student";
const OPEN_COHORT = "ttv-local-persona-cohort-06";
const PROJECT_LABEL = "Propose an idea for a project you would like to build.";
const PREVIOUS_LABEL = "What projects have you built in the past? (either tech or non-tech)";
/** The question's link carries a screen-reader note, "(opens in a new tab)", inside its accessible name. */
const HTML_LABEL = /^Did you complete the free portion of the HTML\/CSS course \(opens in a new tab\)\s?\?$/;

/** A member of the local seed, signed in the way the community persona is. Previews seed other ids, so these skip there. */
function localMember(user: string): PersonaSession | string {
  if (process.env.PLAYWRIGHT_BASE_URL) return "These members are seeded locally only (platform-personas.local.sql).";
  const community = personaSession("community");
  return typeof community === "string" ? community : { ...community, token: `ttv-local-persona-${user}-token` };
}

const applicant = localMember("applicant");
const newcomer = localMember("newcomer");
const reviewee = localMember("reviewee");
// The local seed's cohort persona: a preview's student has a different application id.
const student = localMember("student");
const staff = personaSession("staff");

test.use({ reducedMotion: "reduce" });
test.beforeEach(async ({ page }, testInfo) => {
  if (testInfo.project.name === "mobile-chromium") await page.setViewportSize({ width: 390, height: 844 });
  else await page.setViewportSize({ width: 1440, height: 900 });
});

function evidence(name: string) {
  return `${EVIDENCE_DIR}/${test.info().project.name}-${name}.png`;
}

async function signedIn(context: BrowserContext, page: Page, baseURL: string, session: PersonaSession | string): Promise<"on" | "off"> {
  if (typeof session === "string") throw new Error(session);
  await signIn(context, baseURL, session);
  const frame = (await page.request.get("/api/platform/me")).status() === 404 ? "off" : "on";
  test.info().annotations.push({ type: "spaces", description: frame });
  return frame;
}

/** Pages without JavaScript cannot take the style tag that hides astro dev's toolbar from screenshots. */
let scripted = true;

/** astro dev's toolbar sits over the page in local evidence. */
async function hideDevToolbar(page: Page) {
  if (!scripted || process.env.PLAYWRIGHT_BASE_URL) return;
  await page.waitForLoadState("load");
  await page.addStyleTag({ content: "astro-dev-toolbar { display: none !important; }" });
}

async function open(page: Page, path: string) {
  const response = await page.goto(path);
  expect(response?.status(), path).toBe(200);
  await hideDevToolbar(page);
  return response;
}

/** The legacy URL; with spaces on it redirects to /dashboard/cohort/application/<id>. */
async function openApplication(page: Page, frame: "on" | "off", id: string) {
  await open(page, `/dashboard/application/${id}`);
  const expected = frame === "on" ? `/dashboard/cohort/application/${id}` : `/dashboard/application/${id}`;
  expect(new URL(page.url()).pathname).toBe(expected);
  await expect(page.locator(".spaces-shell")).toHaveCount(frame === "on" ? 1 : 0);
}

/** Nothing a member reads on the page looks like JSON. */
async function expectNoJson(page: Page) {
  const text = await page.locator("main").innerText();
  expect(text).not.toMatch(/JSON/i);
  expect(text).not.toMatch(/[{}]/);
  await expect(page.locator("textarea.font-mono, textarea[name='application']")).toHaveCount(0);
}

async function expectNoSidewaysScroll(page: Page) {
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBeLessThanOrEqual(0);
}

test.describe("a member whose application carries questions", () => {
  test.skip(typeof applicant === "string", typeof applicant === "string" ? applicant : "");

  test("sees them as plain labelled fields holding their answers, and no JSON", async ({ context, page, baseURL }) => {
    const frame = await signedIn(context, page, baseURL!, applicant);

    await open(page, "/dashboard");
    await expect(page.getByRole("link", { name: "Edit answers" })).toHaveAttribute("href", new RegExp(`/application/${APPLICANT_APPLICATION}$`));

    await openApplication(page, frame, APPLICANT_APPLICATION);
    const form = page.locator("form[data-application-answers-form]");
    await expect(form).toBeVisible();
    await expect(page.getByLabel("Name", { exact: true })).toHaveValue("Njeri Wambui");
    // The save test below rewrites the project idea, so this checks an answer nothing changes.
    await expect(page.getByLabel(PREVIOUS_LABEL)).toHaveValue("A savings tracker for my chama, kept in a shared spreadsheet.");
    await expect(page.getByLabel(PROJECT_LABEL)).not.toHaveValue("");
    const html = page.getByRole("group", { name: HTML_LABEL });
    await expect(html.getByRole("radio", { name: "Yes" })).toBeChecked();
    await expect(html.getByRole("link", { name: "HTML/CSS course (opens in a new tab)" })).toHaveAttribute("href", "https://www.codecademy.com/learn/learn-html");
    await expect(page.locator("[data-answer='gitDone']").getByRole("radio", { name: "No" })).toBeChecked();
    await expect(form.getByRole("button", { name: "Save answers" })).toBeVisible();
    await expectNoJson(page);
    await expectNoSidewaysScroll(page);
    await page.screenshot({ path: evidence(`questions-${frame}`), fullPage: true });
    await runAxe(page, test.info(), `application-questions-${frame}`);
  });

  test("gets their typed text back, with each problem named, when an answer is rejected", async ({ context, page, baseURL }) => {
    const frame = await signedIn(context, page, baseURL!, applicant);
    await openApplication(page, frame, APPLICANT_APPLICATION);

    const typed = `I would like to build a matatu route finder for Nairobi.\nIt works offline. (${test.info().project.name})`;
    await page.getByLabel(PROJECT_LABEL).fill(typed);
    // A browser that skips constraint validation: the server must still refuse a missing required choice.
    await page.locator("form[data-application-answers-form]").evaluate((form: HTMLFormElement) => {
      form.noValidate = true;
      form.querySelectorAll<HTMLInputElement>("[data-answer='htmlCssDone'] input").forEach((input) => (input.checked = false));
    });
    const [response] = await Promise.all([
      page.waitForResponse((candidate) => candidate.request().method() === "POST" && candidate.url().includes(APPLICANT_APPLICATION)),
      page.getByRole("button", { name: "Save answers" }).click(),
    ]);
    expect(response.status()).toBe(400);
    await hideDevToolbar(page);

    const alert = page.locator("form[data-application-answers-form] [role='alert']");
    await expect(alert).toContainText("One answer needs another look. Everything you typed is still here.");
    // Announced on arrival: focus moves to the summary, and the title says it failed.
    await expect(alert).toBeFocused();
    await expect(page).toHaveTitle(/^Error: Application details/i);
    await expect(alert.getByRole("link", { name: "Did you complete the free portion of the HTML/CSS course? Choose Yes or No." })).toHaveAttribute("href", "#answer-htmlCssDone");
    await expect(page.getByLabel(PROJECT_LABEL)).toHaveValue(typed);
    await expect(page.getByRole("group", { name: HTML_LABEL }).getByRole("radio", { name: "Yes" })).toHaveAttribute("aria-invalid", "true");
    await expectNoJson(page);
    await page.screenshot({ path: evidence(`questions-error-${frame}`), fullPage: true });
    await runAxe(page, test.info(), `application-questions-error-${frame}`);

    // Nothing was saved.
    await openApplication(page, frame, APPLICANT_APPLICATION);
    await expect(page.getByLabel(PROJECT_LABEL)).not.toHaveValue(typed);
  });

  test.describe("without JavaScript", () => {
    test.use({ javaScriptEnabled: false });
    test.beforeAll(() => (scripted = false));
    test.afterAll(() => (scripted = true));

    test("saves answers into the application, keeps the others, and admins see them", async ({ browser, context, page, baseURL }) => {
      test.skip(test.info().project.name !== "chromium", "Saves change the seeded application; one project writes.");
      const frame = await signedIn(context, page, baseURL!, applicant);
      await openApplication(page, frame, APPLICANT_APPLICATION);

      const idea = `A chama savings dashboard, written ${Date.now()}`;
      await page.getByLabel(PROJECT_LABEL).fill(idea);
      await page.getByRole("button", { name: "Save answers" }).click();
      await expect(page.getByRole("status").filter({ hasText: "Your answers are saved." })).toBeVisible();
      await expect(page.getByLabel(PROJECT_LABEL)).toHaveValue(idea);

      // A fresh read shows the saved answer and every other answer unchanged.
      await openApplication(page, frame, APPLICANT_APPLICATION);
      await expect(page.getByLabel(PROJECT_LABEL)).toHaveValue(idea);
      await expect(page.getByLabel("Name", { exact: true })).toHaveValue("Njeri Wambui");
      await expect(page.getByRole("group", { name: HTML_LABEL }).getByRole("radio", { name: "Yes" })).toBeChecked();
      await expect(page.locator("[data-answer='gitDone']").getByRole("radio", { name: "No" })).toBeChecked();
      await expect(page.getByLabel(PREVIOUS_LABEL)).toHaveValue("A savings tracker for my chama, kept in a shared spreadsheet.");

      // The admin view is unchanged: the same read-only application data, now with the new answer.
      test.skip(typeof staff === "string", typeof staff === "string" ? staff : "");
      if (typeof staff === "string") return;
      const admin = await browser.newContext({ baseURL });
      try {
        await signIn(admin, baseURL!, staff);
        const adminPage = await admin.newPage();
        expect((await adminPage.goto(`/admin/applications/${APPLICANT_APPLICATION}`))?.status()).toBe(200);
        await expect(adminPage.getByRole("heading", { name: "Application Data" })).toBeVisible();
        await expect(adminPage.locator("main")).toContainText(idea);
        await expect(adminPage.locator("form[data-application-answers-form]")).toHaveCount(0);
      } finally {
        await admin.close();
      }
    });
  });
});

test.describe("a member whose application the team reviews while she edits it", () => {
  test.skip(typeof reviewee === "string", typeof reviewee === "string" ? reviewee : "");

  test("is told why her answers can no longer change, and keeps what she typed", async ({ browser, context, page, baseURL }) => {
    test.skip(test.info().project.name !== "chromium", "Approving is once per seed; one project runs it.");
    test.skip(typeof staff === "string", typeof staff === "string" ? staff : "");
    if (typeof staff === "string") return;
    test.setTimeout(60_000);
    const frame = await signedIn(context, page, baseURL!, reviewee);
    await openApplication(page, frame, REVIEWEE_APPLICATION);
    const form = page.locator("form[data-application-answers-form]");
    await expect(form, "Re-apply platform-personas.local.sql: this application is no longer pending.").toBeVisible();

    const typed = `A matatu fare tracker for commuters in Kisumu.\nIt sends a weekly summary. (${Date.now()})`;
    await page.getByLabel(PROJECT_LABEL).fill(typed);

    // Staff approve it from the admin page while the form is still open.
    const admin = await browser.newContext({ baseURL });
    try {
      await signIn(admin, baseURL!, staff);
      const adminPage = await admin.newPage();
      expect((await adminPage.goto(`/admin/applications/${REVIEWEE_APPLICATION}`))?.status()).toBe(200);
      // The admin page asks "Change application status to APPROVED?" first.
      adminPage.once("dialog", (dialog) => void dialog.accept());
      const [approval] = await Promise.all([
        adminPage.waitForResponse((candidate) => candidate.request().method() === "POST" && candidate.url().includes(REVIEWEE_APPLICATION)),
        adminPage.locator("form:has(input[name='status'][value='APPROVED']) button[type='submit']").click(),
      ]);
      expect(approval.status(), "staff approval redirects back to the application").toBe(302);
      await adminPage.waitForURL(new RegExp(`/admin/applications/${REVIEWEE_APPLICATION}$`));
      await expect(adminPage.locator("form:has(input[name='status'][value='APPROVED'])")).toHaveCount(0);
    } finally {
      await admin.close();
    }

    const [response] = await Promise.all([
      page.waitForResponse((candidate) => candidate.request().method() === "POST" && candidate.url().includes(REVIEWEE_APPLICATION)),
      form.getByRole("button", { name: "Save answers" }).click(),
    ]);
    expect(response.status()).toBe(409);
    await hideDevToolbar(page);

    await expect(page.getByRole("alert").filter({ hasText: "The team reviewed this application before your answers were saved" })).toBeVisible();
    await expect(page.locator("form[data-application-answers-form]")).toHaveCount(0);
    const unsaved = page.locator("[data-unsaved-answers]");
    await expect(unsaved.getByRole("heading", { name: "Your unsaved answers" })).toBeVisible();
    await expect(unsaved.locator("dd").filter({ hasText: "A matatu fare tracker for commuters in Kisumu." })).toHaveText(typed);
    // The saved answers are unchanged, under their own heading.
    await expect(page.getByRole("heading", { name: "Saved answers", exact: true })).toBeVisible();
    await expect(page.locator("[data-application-answers-summary]")).toContainText("A shared calendar for a youth football league.");
    await expectNoJson(page);
    await page.screenshot({ path: evidence(`reviewed-while-editing-${frame}`), fullPage: true });
    await runAxe(page, test.info(), `application-reviewed-while-editing-${frame}`);
  });
});

test.describe("a member applying to a cohort that asks no questions", () => {
  test.skip(typeof newcomer === "string", typeof newcomer === "string" ? newcomer : "");

  test("is told it was submitted, without a contradiction, and gets no edit step", async ({ context, page, baseURL }) => {
    test.skip(test.info().project.name !== "chromium", "Applying is once per seed; the phone view is captured in this test.");
    // The whole journey, two widths and two axe runs, in one test.
    test.setTimeout(60_000);
    const frame = await signedIn(context, page, baseURL!, newcomer);

    await open(page, "/dashboard/apply");
    const cohort = page.locator(`[data-cohort-id="${OPEN_COHORT}"]`);
    await expect(cohort, "Re-apply platform-personas.local.sql: the newcomer has already applied.").toBeVisible();
    await cohort.getByRole("button", { name: "Apply" }).click();

    await expect(page).toHaveURL(/notice=application-submitted/);
    await hideDevToolbar(page);
    const submitted = page.locator("[data-application-submitted]");
    await expect(submitted).toHaveAttribute("role", "status");
    await expect(submitted).toContainText("Your cohort application was submitted.");
    await expect(submitted).toContainText(frame === "on" ? "on your Cohort page" : "from your dashboard");
    await expect(page.getByText("No cohorts are accepting applications")).toHaveCount(0);
    await expect(page.getByText("You may already have applied")).toHaveCount(0);
    await expect(page.locator("[data-apply-empty]")).toHaveCount(0);
    await page.screenshot({ path: evidence(`submitted-${frame}`), fullPage: true });
    await page.setViewportSize({ width: 390, height: 844 });
    await expectNoSidewaysScroll(page);
    await page.screenshot({ path: evidence(`submitted-${frame}-390`), fullPage: true });
    await runAxe(page, test.info(), `apply-submitted-${frame}`);
    await page.setViewportSize({ width: 1440, height: 900 });

    // Their next step offers the application, not answers to edit.
    await submitted.getByRole("link", { name: "View your applications" }).click();
    await expect(page.getByRole("link", { name: "Edit answers" })).toHaveCount(0);
    const view = page.getByRole("link", { name: "View application" });
    await expect(view).toBeVisible();
    await view.click();
    await expect(page).toHaveURL(/\/application\//);
    await hideDevToolbar(page);

    await expect(page.locator("[data-application-answers-summary]")).toHaveText(
      "This cohort doesn't ask any application questions, so there's nothing to fill in. Your application's status is shown above and changes when the team reviews it.",
    );
    await expect(page.locator("main form, main textarea")).toHaveCount(0);
    await expect(page.getByRole("button", { name: /save/i })).toHaveCount(0);
    await expectNoJson(page);
    await page.screenshot({ path: evidence(`no-questions-${frame}`), fullPage: true });
    await runAxe(page, test.info(), `application-no-questions-${frame}`);

    // A hand-made JSON post changes nothing: members cannot write the stored application.
    const applicationUrl = page.url();
    const posted = await page.request.post(applicationUrl, {
      headers: { Origin: new URL(applicationUrl).origin },
      form: { application: '{"about":"written as JSON"}' },
    });
    expect(posted.status()).toBe(200);
    await open(page, applicationUrl);
    await expect(page.locator("[data-application-answers-summary]")).toContainText("doesn't ask any application questions");
    await expect(page.locator("main")).not.toContainText("written as JSON");
  });
});

test.describe("the cohort persona, accepted with no answers recorded", () => {
  test.skip(typeof student === "string", typeof student === "string" ? student : "");

  test("sees a read-only, truthful state and no form", async ({ context, page, baseURL }) => {
    const frame = await signedIn(context, page, baseURL!, student);
    await openApplication(page, frame, STUDENT_APPLICATION);
    await expect(page.locator("[data-application-answers-summary]")).toHaveText("No answers were recorded with this application.");
    await expect(page.locator("main form, main textarea")).toHaveCount(0);
    await expectNoJson(page);
    await expectNoSidewaysScroll(page);
    await page.screenshot({ path: evidence(`approved-${frame}`), fullPage: true });
  });
});
