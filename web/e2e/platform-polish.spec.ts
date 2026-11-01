import { mkdirSync } from "node:fs";
import { expect, test, type Page } from "@playwright/test";
import { runAxe } from "./platform-axe";
import { personaSession, signIn, type PersonaKey } from "./platform-personas";

/**
 * F-3: the Phase 1 polish that QA-1 asked for, in a real browser, as the
 * people who met each problem. Admin has a way back and a skip link (QA1-12);
 * leaving a space for a page outside the shell raises no error (QA1-22);
 * search says what it covers (QA1-11); the community sidebar says its member
 * and mentor links are public pages (QA1-10); mentoring uses one label for
 * what is not open yet.
 *
 * Sessions are cookies (platform-personas.ts): the local seed, or an isolated
 * agent preview's personas. Everything skips where the spaces flag is off.
 */

const EVIDENCE_DIR = "test-results/evidence/platform-polish";
mkdirSync(EVIDENCE_DIR, { recursive: true });

test.beforeEach(async ({ page }, testInfo) => {
  if (testInfo.project.name === "mobile-chromium") await page.setViewportSize({ width: 390, height: 844 });
  else await page.setViewportSize({ width: 1440, height: 900 });
});

const wide = (page: Page) => (page.viewportSize()?.width ?? 0) >= 1024;
const evidence = (name: string) => `${EVIDENCE_DIR}/${test.info().project.name}-${name}.png`;

/** Routes Google Fonts through Node, which can reach them when the browser in a dev container cannot. */
async function routeFonts(page: Page) {
  await page.route(/fonts\.(googleapis|gstatic)\.com/, async (route) => {
    try {
      const response = await fetch(route.request().url());
      await route.fulfill({ status: response.status, headers: Object.fromEntries(response.headers), body: Buffer.from(await response.arrayBuffer()) });
    } catch {
      await route.abort();
    }
  });
}

async function open(page: Page, path: string) {
  const response = await page.goto(path);
  expect(response?.status(), path).toBe(200);
  await expect(page.locator("astro-island[ssr]")).toHaveCount(0);
  if (!process.env.PLAYWRIGHT_BASE_URL) await page.addStyleTag({ content: "astro-dev-toolbar { display: none !important; }" });
  await page.evaluate(() => document.fonts.ready);
}

/** Signs in as the persona, or skips: no session here, or the spaces flag is off for them. */
function as(key: PersonaKey) {
  const session = personaSession(key);
  test.skip(typeof session === "string", typeof session === "string" ? session : "");
  test.beforeEach(async ({ context, page, baseURL }) => {
    if (typeof session === "string") return;
    await routeFonts(page);
    await signIn(context, baseURL!, session);
    const me = await page.request.get("/api/platform/me");
    test.skip(me.status() === 404, "The spaces flag is off here.");
    expect(me.status()).toBe(200);
  });
}

test.describe("staff in admin (QA1-12)", () => {
  as("staff");

  test("the admin pages start with a skip link and keep a way back to the dashboard", async ({ page }) => {
    await open(page, "/admin");
    await page.keyboard.press("Tab");
    const skip = page.locator(":focus");
    await expect(skip).toHaveText("Skip to content");
    await expect(skip).toBeInViewport();
    await page.keyboard.press("Enter");
    await expect(page.locator("main#admin-main")).toBeFocused();
    await runAxe(page, test.info(), "admin-home");

    if (!wide(page)) await page.getByRole("button", { name: "Open navigation" }).click();
    const back = page.getByRole("link", { name: "Back to dashboard" }).filter({ visible: true });
    await expect(back).toHaveAttribute("href", "/dashboard");
    await page.screenshot({ path: evidence("admin-way-back") });
    await back.click();
    // /dashboard opens the person's own spaces again.
    await expect(page.locator(".spaces-shell")).toBeVisible();
    expect(new URL(page.url()).pathname).toMatch(/^\/dashboard(\/|$)/);
  });
});

test.describe("leaving a space for a page outside the shell (QA1-22)", () => {
  // The space-to-space transition only runs for people who have not asked for reduced motion.
  test.use({ reducedMotion: "no-preference" });
  as("staff");

  test("raises no error, while switching spaces still transitions", async ({ page }) => {
    test.skip(!wide(page), "The tab row is the wide layout's.");
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(`${error.message} @ ${page.url()}`));
    await page.addInitScript(() => {
      addEventListener("pagereveal", (event) => {
        sessionStorage.setItem("revealed", String(Boolean((event as Event & { viewTransition?: unknown }).viewTransition)));
      });
    });
    await open(page, "/dashboard/cohort");
    await page.locator(".space-file__nav").getByRole("link", { name: /^Community/ }).click();
    await expect(page).toHaveURL(/\/dashboard\/community$/);
    await expect(page.locator("astro-island[ssr]")).toHaveCount(0);
    expect(await page.evaluate(() => sessionStorage.getItem("revealed")), "space to space").toBe("true");

    await page.locator(".space-file__nav").getByRole("link", { name: /^Admin/ }).click();
    await expect(page).toHaveURL(/\/admin$/);
    await expect(page.getByRole("link", { name: "Back to dashboard" })).toBeVisible();
    // A late error would arrive on the new page: give it the length of a transition.
    await page.waitForTimeout(500);
    expect(errors).toEqual([]);
  });
});

test.describe("search says what it covers (QA1-11)", () => {
  as("student");

  test("the trigger and the box name what is searched, never everything", async ({ page }) => {
    await open(page, "/dashboard/cohort");
    const trigger = page.getByRole("button", { name: "Search", exact: true });
    await expect(trigger).toBeVisible();
    await trigger.click();
    const box = page.getByRole("combobox", { name: "Search people, projects and your sessions" });
    await expect(box).toBeFocused();
    await expect(page.locator(".search-overlay__status")).toHaveText(/^Finds people with public profiles, .+ and moments from your own cohort's sessions\.$/);
    await expect(page.getByRole("dialog", { name: "Search", exact: true })).not.toContainText(/everything|everywhere/i);
    await runAxe(page, test.info(), "search-open");
    await page.screenshot({ path: evidence("search-coverage") });
  });
});

test.describe("community sidebar (QA1-10)", () => {
  as("community");

  test("labels the member and mentor pages as public pages", async ({ page }) => {
    await open(page, "/dashboard/community");
    if (!wide(page)) await page.getByRole("link", { name: /^Open .+ menu$/ }).click();
    const group = page.getByRole("list", { name: "Public pages" });
    await expect(group.getByRole("link", { name: "For members" })).toHaveAttribute("href", "/community/members");
    await expect(group.getByRole("link", { name: "For mentors" })).toHaveAttribute("href", "/community/mentors");
    await expect(page.locator("#space-sidebar")).not.toContainText("Directory");
  });
});

test.describe("mentoring (one label for what is not open yet)", () => {
  as("mentor");

  test("the sidebar and the overview say the same thing", async ({ page }) => {
    await open(page, "/dashboard/mentoring");
    if (!wide(page)) await page.getByRole("link", { name: /^Open .+ menu$/ }).click();
    for (const name of ["Requests", "Availability"]) {
      await expect(page.locator("#space-sidebar").getByRole("link", { name: new RegExp(`^${name}`) })).toContainText("Not open yet");
      await expect(page.locator(`#${name.toLowerCase()}`)).toContainText("Not open yet");
    }
    await expect(page.locator("#space-sidebar")).not.toContainText("Soon");
  });
});
