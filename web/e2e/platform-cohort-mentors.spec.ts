import { mkdirSync } from "node:fs";
import { expect, test, type Page } from "@playwright/test";
import { runAxe } from "./platform-axe";
import { personaSession, signIn, type PersonaKey } from "./platform-personas";

/**
 * U-2.4: per-cohort mentors on /admin/programs/[id]. An administrator adds David (a community
 * mentor) to Cohort 05; David then has the Cohort space, with its recordings and channels. Removing
 * him takes it away on his next request. Members who are not administrators reach none of it.
 *
 * Local seed only (platform-personas.local.sql), with astro dev on PLATFORM_FLAGS_OVERRIDE=all and
 * PLATFORM_PERSONAS_LOCAL_SECRET set. Adding and removing change the seed, so only the desktop
 * project writes, and the test leaves David as it found him.
 */

const EVIDENCE_DIR = "test-results/evidence/platform-cohort-mentors";
mkdirSync(EVIDENCE_DIR, { recursive: true });
const COHORT = "/admin/programs/ttv-local-persona-cohort-05";
const DAVID = "ttv-local-persona-mentor";

test.use({ reducedMotion: "reduce" });
test.describe.configure({ mode: "serial", timeout: 90_000 });
test.skip(Boolean(process.env.PLAYWRIGHT_BASE_URL), "These people are seeded locally only (platform-personas.local.sql).");

test.beforeEach(async ({ page }, testInfo) => {
  if (testInfo.project.name === "mobile-chromium") await page.setViewportSize({ width: 390, height: 844 });
  else await page.setViewportSize({ width: 1440, height: 900 });
});

async function as(page: Page, baseURL: string | undefined, key: PersonaKey) {
  const session = personaSession(key);
  test.skip(typeof session === "string", typeof session === "string" ? session : "");
  if (typeof session === "string") return;
  await page.context().clearCookies();
  await signIn(page.context(), baseURL!, session);
}

async function open(page: Page, path: string) {
  const response = await page.goto(path);
  expect(response?.status(), path).toBe(200);
  await page.addStyleTag({ content: "astro-dev-toolbar { display: none !important; }" });
  await page.evaluate(() => document.fonts.ready);
}

const mentors = (page: Page) => page.locator("[data-cohort-mentors]");
const notice = (page: Page) => page.locator("div[role=status]");

/** Leaves Cohort 05 without David as a mentor, whatever an earlier, interrupted run did. */
async function removeDavidIfListed(page: Page) {
  const remove = mentors(page).getByRole("button", { name: "Remove David Kamau as a mentor" });
  if ((await remove.count()) === 0) return;
  page.once("dialog", (dialog) => dialog.accept());
  await remove.click();
  await expect(notice(page)).toHaveText("Mentor removed. Their mentor access to this cohort has ended.");
}
// The desktop tabs: this journey runs at 1440 only.
const cohortTab = (page: Page) => page.locator(".space-file__nav .space-tab__label").filter({ hasText: /^Cohort$/ });

test("an administrator adds and removes a cohort mentor, and the mentor's access follows", async ({ page, baseURL }, testInfo) => {
  test.skip(testInfo.project.name !== "chromium", "Adding and removing change the seed; one project writes.");
  await as(page, baseURL, "staff");
  await open(page, COHORT);
  await removeDavidIfListed(page);

  await as(page, baseURL, "mentor");
  await open(page, "/dashboard/community");
  await expect(cohortTab(page)).toHaveCount(0);

  await as(page, baseURL, "staff");
  await open(page, COHORT);
  await expect(mentors(page).getByRole("heading", { level: 3, name: "Mentors" })).toBeVisible();
  await expect(mentors(page).locator(`[data-cohort-mentor="${DAVID}"]`)).toHaveCount(0);
  // Community mentors are offered first.
  await expect(mentors(page).locator('optgroup[label="Community mentors"] option', { hasText: "David Kamau" })).toHaveCount(1);
  await mentors(page).getByRole("combobox", { name: "Person" }).selectOption(DAVID);
  await mentors(page).getByRole("button", { name: "Add mentor" }).click();
  await expect(notice(page)).toHaveText("Mentor added. They can open this cohort's recordings and channels now.");
  const david = mentors(page).locator(`[data-cohort-mentor="${DAVID}"]`);
  await expect(david).toContainText("David Kamau");
  await expect(david).toContainText("Community mentor");
  // Mentors have their own list: the staff table stays instructors and TAs.
  await expect(page.locator("table").getByText("MENTOR")).toHaveCount(0);
  await runAxe(page, testInfo, "cohort-mentors", { include: ["[data-cohort-mentors]"] });
  await mentors(page).screenshot({ path: `${EVIDENCE_DIR}/${testInfo.project.name}-added.png` });

  await as(page, baseURL, "mentor");
  await open(page, "/dashboard/community");
  await expect(cohortTab(page)).toHaveCount(1);

  await as(page, baseURL, "staff");
  await open(page, COHORT);
  await removeDavidIfListed(page);
  await expect(mentors(page).locator(`[data-cohort-mentor="${DAVID}"]`)).toHaveCount(0);

  await as(page, baseURL, "mentor");
  await open(page, "/dashboard/community");
  await expect(cohortTab(page)).toHaveCount(0);
});

test("lays the mentors section out without sideways scroll, with 44px controls", async ({ page, baseURL }, testInfo) => {
  await as(page, baseURL, "staff");
  await open(page, COHORT);
  await mentors(page).scrollIntoViewIfNeeded();
  for (const control of await mentors(page).locator("select, button").all()) {
    expect((await control.boundingBox())?.height ?? 0).toBeGreaterThanOrEqual(44);
  }
  expect(await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)).toBe(0);
  await mentors(page).screenshot({ path: `${EVIDENCE_DIR}/${testInfo.project.name}-section.png` });
});

test("members who are not administrators cannot manage cohort mentors", async ({ page, baseURL }) => {
  for (const key of ["mentor", "student", "community"] as const) {
    await as(page, baseURL, key);
    await page.goto(COHORT);
    await expect(page, key).toHaveURL(/\/dashboard/);
    const response = await page.request.post(COHORT, {
      form: { action: "add-role", roleName: "MENTOR", userId: DAVID },
      headers: { Origin: new URL(baseURL!).origin },
      maxRedirects: 0,
    });
    expect(response.status(), key).toBeGreaterThanOrEqual(300);
    expect(response.status(), key).toBeLessThan(400);
    expect(response.headers().location ?? "", key).not.toContain("notice=mentor-added");
  }
});
