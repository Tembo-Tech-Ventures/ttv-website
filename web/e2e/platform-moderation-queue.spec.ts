import { mkdirSync } from "node:fs";
import { expect, test, type BrowserContext, type Locator, type Page } from "@playwright/test";
import { runAxe } from "./platform-axe";
import { personaSession, signIn, type PersonaKey, type PersonaSession } from "./platform-personas";

/**
 * U-2.4: the real /admin/moderation page over B-2.5's queue and decisions (the DEV harness spec,
 * platform-moderation.spec.ts, holds the interaction contract over fixtures):
 * - only administrators reach it; a channel moderator who is not one does not;
 * - the queue as screens/08 lays it out, axe A/AA clean, at 1440 and 390;
 * - Fine as is, Keep hidden and Restore, each recorded with who decided and why;
 * - a decision someone else made first is refused, and the page never says it was made;
 * - without JavaScript, a plain form post decides.
 *
 * Local seed only (the U-2.4 rows in platform-personas.local.sql): run astro dev with
 * PLATFORM_FLAGS_OVERRIDE=all and set PLATFORM_PERSONAS_LOCAL_SECRET. Deciding changes the seed,
 * so only the desktop project writes; re-seed to run again.
 */

const EVIDENCE_DIR = "test-results/evidence/platform-moderation-queue";
mkdirSync(EVIDENCE_DIR, { recursive: true });

const QUEUE = "/admin/moderation";
const FLAGGED = "ttv-local-moderation-flagged"; // contact details, flagged by the detectors
const REPORTED = "ttv-local-moderation-reported"; // reported by a member, still visible
const MENTOR_HIDDEN = "ttv-local-moderation-mentor-hidden"; // hidden by David, a cohort mentor
const TEMBO_HIDDEN = "ttv-local-moderation-tembo-hidden"; // hidden by Tembo as spam
const STALE = "ttv-local-moderation-stale"; // decided in a second tab while the first one reads it

function local(key: PersonaKey): PersonaSession | string {
  if (process.env.PLAYWRIGHT_BASE_URL) return "These cases are seeded locally only (platform-personas.local.sql).";
  return personaSession(key);
}
const staff = local("staff");

test.use({ reducedMotion: "reduce" });
// Serial: each decision changes what the next test sees.
test.describe.configure({ mode: "serial", timeout: 90_000 });
test.beforeEach(async ({ page }, testInfo) => {
  test.skip(typeof staff === "string", typeof staff === "string" ? staff : "");
  if (testInfo.project.name === "mobile-chromium") await page.setViewportSize({ width: 390, height: 844 });
  else await page.setViewportSize({ width: 1440, height: 900 });
});

function writesOnce() {
  test.skip(test.info().project.name !== "chromium", "Deciding changes the seed; one project writes.");
}

async function as(context: BrowserContext, baseURL: string | undefined, session: PersonaSession | string) {
  if (typeof session === "string") throw new Error(session);
  await signIn(context, baseURL!, session);
}

async function open(page: Page, path = QUEUE) {
  const response = await page.goto(path);
  expect(response?.status(), path).toBe(200);
  await page.waitForLoadState("load");
  await page.addStyleTag({ content: "astro-dev-toolbar { display: none !important; }" });
  await expect(page.locator("astro-island[ssr]")).toHaveCount(0);
  await page.evaluate(() => document.fonts.ready);
}

const card = (page: Page, id: string) => page.locator(`[data-moderation-case="${id}"]`);
const reason = (scope: Locator) => scope.getByRole("textbox", { name: "Reason" });
const notice = (page: Page) => page.locator("[data-moderation-notice]");
const evidence = (name: string) => `${EVIDENCE_DIR}/${test.info().project.name}-${name}.png`;

/** Pressed from the keyboard: the site's feedback pill can sit over the last row at 1440 x 900. */
async function press(button: Locator) {
  await button.focus();
  await button.press("Enter");
}

async function decide(page: Page, id: string, button: RegExp, why: string) {
  await reason(card(page, id)).fill(why);
  await press(card(page, id).getByRole("button", { name: button }));
}

test("only administrators reach the queue", async ({ browser, baseURL }) => {
  const signedOut = await browser.newPage();
  await signedOut.goto(QUEUE);
  await expect(signedOut).toHaveURL(/\/auth\/login/);
  await signedOut.close();

  // David moderates his cohort's channels, and Lucy is a member: neither is an administrator.
  for (const key of ["mentor", "community"] as const) {
    const context = await browser.newContext();
    await as(context, baseURL, local(key));
    const page = await context.newPage();
    await page.goto(QUEUE);
    await expect(page, key).toHaveURL(/\/dashboard/);
    await expect(page.locator("[data-moderation-root]")).toHaveCount(0);
    // A decision posted straight at the page is turned away the same way, and decides nothing.
    const posted = await page.request.post(QUEUE, {
      form: { messageId: FLAGGED, action: "keep", reason: "Fine." }, maxRedirects: 0, headers: { origin: baseURL! },
    });
    expect([302, 303], key).toContain(posted.status());
    await context.close();
  }
});

test("lays the queue out as screens/08 does, clean under axe", async ({ page, context, baseURL }, testInfo) => {
  await as(context, baseURL, staff);
  await open(page);
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
  for (const id of [FLAGGED, REPORTED, MENTOR_HIDDEN, TEMBO_HIDDEN, STALE]) await expect(card(page, id)).toHaveAttribute("data-state", "PENDING");
  // Restore only on a hidden message, Fine as is only on one that is not.
  await expect(card(page, MENTOR_HIDDEN).getByRole("button", { name: /^Restore/ })).toBeVisible();
  await expect(card(page, MENTOR_HIDDEN).getByRole("button", { name: /^Keep hidden/ })).toBeVisible();
  await expect(card(page, MENTOR_HIDDEN).getByRole("button", { name: /^Fine as is/ })).toHaveCount(0);
  await expect(card(page, FLAGGED).getByRole("button", { name: /^Fine as is/ })).toBeVisible();
  await expect(card(page, FLAGGED).getByRole("button", { name: /^Restore/ })).toHaveCount(0);
  await expect(card(page, MENTOR_HIDDEN)).toContainText("Hidden by David Kamau");
  await expect(card(page, REPORTED)).toContainText("Reported by 1 member");

  const width = await page.evaluate(() => document.documentElement.scrollWidth);
  expect(width, "no sideways scroll").toBeLessThanOrEqual(page.viewportSize()!.width);
  await runAxe(page, testInfo, "moderation-queue-live");
  await page.screenshot({ path: evidence("queue"), fullPage: true });
});

test("keeps, keeps hidden and restores, each with who decided and why", async ({ page, context, baseURL }) => {
  writesOnce();
  await as(context, baseURL, staff);
  await open(page);

  await decide(page, FLAGGED, /^Fine as is/, "A phone number shared between two cohort mates who asked for it.");
  await expect(notice(page)).toHaveText(/^Kept as is\./);
  await expect(card(page, FLAGGED)).toHaveCount(0);

  await decide(page, TEMBO_HIDDEN, /^Keep hidden/, "Selling followers is spam.");
  await expect(notice(page)).toHaveText(/^Hidden\./);

  await decide(page, MENTOR_HIDDEN, /^Restore/, "Blunt, but about the code. The author has been asked to reword it.");
  await expect(notice(page)).toHaveText(/^Restored\./);

  await notice(page).getByRole("link", { name: "See decided cases" }).click();
  const decided = (id: string) => card(page, id).locator("[data-moderation-decision]");
  await expect(decided(FLAGGED)).toContainText("Kept as is by Amina Hassan");
  await expect(decided(TEMBO_HIDDEN)).toContainText("Hidden by Amina Hassan");
  await expect(decided(TEMBO_HIDDEN)).toContainText("Selling followers is spam.");
  await expect(decided(MENTOR_HIDDEN)).toContainText("Restored by Amina Hassan");
  await expect(card(page, MENTOR_HIDDEN).locator("[data-moderation-context]")).toContainText("still visible");
  await expect(card(page, TEMBO_HIDDEN).locator("[data-moderation-context]")).toContainText("hidden from members");
  await page.screenshot({ path: evidence("decided"), fullPage: true });
});

test("never shows a decision someone else made first as made", async ({ page, context, baseURL }) => {
  writesOnce();
  await as(context, baseURL, staff);
  await open(page);
  await expect(card(page, STALE).getByRole("button", { name: /^Fine as is/ })).toBeVisible();

  // A second administrator tab hides the message while this one is still reading it.
  const other = await context.newPage();
  await open(other);
  await decide(other, STALE, /^Hide/, "A phone number in a public channel.");
  await expect(notice(other)).toHaveText(/^Hidden\./);
  await other.close();

  await decide(page, STALE, /^Fine as is/, "Fine as it is.");
  const failure = page.locator("[data-moderation-failure]");
  await expect(failure).toHaveText(/^Nothing changed\./);
  await expect(notice(page)).toHaveCount(0);
  await page.goto(`${QUEUE}?state=DECIDED`);
  await expect(card(page, STALE).locator("[data-moderation-decision]")).toContainText("Hidden by Amina Hassan");
  await page.screenshot({ path: evidence("refused") });
});

test.describe("without JavaScript", () => {
  test.use({ javaScriptEnabled: false });

  test("hides with a plain form post", async ({ page, context, baseURL }) => {
    writesOnce();
    await as(context, baseURL, staff);
    await page.goto(QUEUE);
    await decide(page, REPORTED, /^Hide/, "Aimed at people rather than their code.");
    await expect(page).toHaveURL(/decided=hide/);
    await expect(notice(page)).toHaveText(/^Hidden\. Members no longer see the message\./);
    await expect(card(page, REPORTED)).toHaveCount(0);
  });
});
