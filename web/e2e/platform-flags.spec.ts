import { mkdirSync } from "node:fs";
import { expect, test, type APIRequestContext, type BrowserContext, type Locator, type Page } from "@playwright/test";
import { runAxe } from "./platform-axe";
import { personaSession, signIn, type PersonaSession } from "./platform-personas";

/**
 * U-F.1: the admin feature flags page, /admin/platform-flags, as an administrator and a member:
 * - every flag with what it controls, who sees it and who changed it, clean under axe at 1440 and 390;
 * - an administrator switches Spaces from Off to Staff, it stays switched, and a dependency warning
 *   comes and goes with it;
 * - Everyone asks first, and the whole path works without JavaScript;
 * - members who are not administrators, and other sites, change nothing.
 *
 * Runs against the local seed (platform-personas.local.sql) or this run's isolated agent preview,
 * where PLATFORM_FLAGS_OVERRIDE=all keeps the stored settings from changing what anyone sees.
 * Never against staging or production: there are no persona sessions there (personaSession).
 * Writes happen in the desktop project only, and each test puts back what it changed.
 */

const EVIDENCE_DIR = "test-results/evidence/platform-flags";
mkdirSync(EVIDENCE_DIR, { recursive: true });

const PAGE = "/admin/platform-flags";
const API = "/api/admin/platform-flags";
type Audience = "OFF" | "STAFF" | "ALL";

const staff = personaSession("staff");
const member = personaSession("community");

test.use({ reducedMotion: "reduce" });
test.describe.configure({ mode: "serial", timeout: 60_000 });
test.beforeEach(async ({ page }, testInfo) => {
  test.skip(typeof staff === "string", typeof staff === "string" ? staff : "");
  if (testInfo.project.name === "mobile-chromium") await page.setViewportSize({ width: 390, height: 844 });
  else await page.setViewportSize({ width: 1440, height: 900 });
});

function writesOnce() {
  test.skip(test.info().project.name !== "chromium", "Switching flags changes shared state; one project writes.");
}

async function as(context: BrowserContext, baseURL: string | undefined, session: PersonaSession | string) {
  if (typeof session === "string") throw new Error(session);
  await signIn(context, baseURL!, session);
}

async function open(page: Page, path = PAGE) {
  const response = await page.goto(path);
  expect(response?.status(), path).toBe(200);
  await hideDevToolbar(page);
  return response;
}

/** Pages opened without JavaScript have no dev toolbar, and no script to hide it with. */
const scriptless = new WeakSet<Page>();

async function hideDevToolbar(page: Page) {
  if (process.env.PLAYWRIGHT_BASE_URL || scriptless.has(page)) return;
  await page.waitForLoadState("load");
  await page.addStyleTag({ content: "astro-dev-toolbar { display: none !important; }" });
}

/**
 * Presses a control from the keyboard: focus, then Enter. The site-wide Feedback pill is fixed to
 * the bottom right, so a pointer click on the last row can land on the pill instead (and without
 * JavaScript the pill is a disabled button). Keyboard activation needs no hit-testing and no script.
 */
async function press(control: Locator) {
  await control.focus();
  await control.press("Enter");
}

function row(page: Page, key: string) {
  return page.locator(`[data-flag="${key}"]`);
}

function evidence(name: string) {
  return `${EVIDENCE_DIR}/${test.info().project.name}-${name}.png`;
}

async function stored(request: APIRequestContext): Promise<Record<string, { audience: Audience; updatedBy: string | null }>> {
  const response = await request.get(API);
  expect(response.status()).toBe(200);
  const { flags } = await response.json() as { flags: { key: string; audience: Audience; updatedBy: string | null }[] };
  return Object.fromEntries(flags.map((flag) => [flag.key, flag]));
}

/** Puts flags back through the existing admin API, same-origin as the page. */
async function restore(page: Page, baseURL: string | undefined, audiences: Record<string, Audience>) {
  for (const [key, audience] of Object.entries(audiences)) {
    const response = await page.request.put(`${API}/${key}`, { data: { audience }, headers: { Origin: new URL(baseURL!).origin } });
    expect(response.status(), `restore ${key}`).toBe(200);
  }
}

test("lists every flag with what it controls, who sees it and who changed it, clean under axe", async ({ context, page, baseURL }, testInfo) => {
  await as(context, baseURL, staff);
  await open(page);

  await expect(page.getByRole("heading", { level: 2, name: "Feature flags" })).toBeVisible();
  const flags = page.getByRole("list", { name: "Platform feature flags" }).locator("[data-flag]");
  expect(await flags.evaluateAll((items) => items.map((item) => item.getAttribute("data-flag"))))
    .toEqual(["spaces", "onboarding", "channels", "tembo_channels", "mentor_requests"]);

  const spaces = row(page, "spaces");
  await expect(spaces.getByRole("heading", { level: 3, name: "Spaces" })).toBeVisible();
  await expect(spaces).toContainText("tabs for Cohort, Community, Mentoring and Discover");
  await expect(spaces.locator("[data-flag-changed]")).toHaveText(/^(Never changed\.|Changed \d{1,2} \w{3} \d{4}, \d{2}:\d{2} Nairobi time.+)$/);
  // Each flag shows its setting, and offers the other two by name.
  for (const key of ["spaces", "onboarding", "channels", "tembo_channels", "mentor_requests"]) {
    const flag = row(page, key);
    const audience = await flag.getAttribute("data-audience");
    await expect(flag.locator("[data-flag-current]")).toHaveText(`${{ OFF: "Off", STAFF: "Staff", ALL: "Everyone" }[audience!]} (current)`);
    await expect(flag.getByRole("group", { name: /^Who sees / }).getByRole("button")).toHaveCount(2);
  }
  if (test.info().project.name === "chromium") {
    await expect(page.locator(`aside a[href="${PAGE}"]`)).toHaveAttribute("aria-current", "page");
  }

  // 44px targets, and nothing scrolls sideways at 390.
  for (const control of await page.locator("main [data-flag-form] button").all()) {
    expect((await control.boundingBox())?.height ?? 0).toBeGreaterThanOrEqual(44);
  }
  expect(await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)).toBe(0);

  await runAxe(page, testInfo, "platform-flags");
  await page.screenshot({ path: evidence("list"), fullPage: true });
});

test("asks before Everyone, and changes nothing until it is confirmed", async ({ context, page, baseURL }, testInfo) => {
  await as(context, baseURL, staff);
  await open(page);
  const before = await stored(page.request);
  // Channels is still in development, so Everyone is safe to ask about here.
  test.skip(before.channels.audience === "ALL", "Channels is already Everyone here.");

  await press(row(page, "channels").getByRole("button", { name: "Set Channels to Everyone" }));
  await hideDevToolbar(page);
  const confirm = page.locator("[data-flag-confirm='channels']");
  await expect(confirm.getByRole("heading", { name: "Show Channels to everyone?" })).toBeVisible();
  await expect(confirm).toContainText("This makes it visible to every signed-in user.");
  await expect(confirm).toBeFocused();
  expect((await stored(page.request)).channels.audience).toBe(before.channels.audience);
  expect(await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)).toBe(0);
  await runAxe(page, testInfo, "platform-flags-confirm");
  await page.screenshot({ path: evidence("confirm"), fullPage: true });

  await press(confirm.getByRole("link", { name: "Cancel" }));
  await expect(page).toHaveURL(new RegExp(`${PAGE}$`));
  await expect(page.locator("[data-flag-confirm]")).toHaveCount(0);
  expect((await stored(page.request)).channels.audience).toBe(before.channels.audience);
});

test("an administrator switches Spaces from Off to Staff, and it stays", async ({ context, page, baseURL }) => {
  writesOnce();
  await as(context, baseURL, staff);
  await open(page);
  const before = await stored(page.request);
  try {
    // Start from Off with onboarding at Staff: onboarding then reaches more people than Spaces.
    await restore(page, baseURL, { spaces: "OFF", onboarding: "STAFF" });
    await open(page);
    const onboarding = row(page, "onboarding");
    await expect(onboarding.locator("[data-flag-warning]")).toHaveText(
      "Warning: Onboarding needs Spaces, which is Off. Set Spaces to Staff too, or Onboarding won't work for everyone it is set for."
    );

    await press(row(page, "spaces").getByRole("button", { name: "Set Spaces to Staff" }));
    await hideDevToolbar(page);
    await expect(page).toHaveURL(new RegExp(`${PAGE}\\?changed=spaces$`));
    await expect(page.getByRole("status")).toHaveText("Spaces is now Staff: administrators only.");
    await expect(page.locator("[data-flag-notice]")).toBeFocused();
    await expect(onboarding.locator("[data-flag-warning]")).toHaveCount(0);
    await page.screenshot({ path: evidence("switched"), fullPage: true });

    // A fresh load reads it back from the database, with who changed it.
    await open(page);
    const spaces = row(page, "spaces");
    await expect(spaces).toHaveAttribute("data-audience", "STAFF");
    await expect(spaces.locator("[data-flag-current]")).toHaveText("Staff (current)");
    await expect(spaces.locator("[data-flag-changed]")).toHaveText(
      process.env.PLAYWRIGHT_BASE_URL ? /^Changed .+ Nairobi time by \S.+\.$/ : /^Changed .+ Nairobi time by Amina Hassan\.$/
    );
    const after = await stored(page.request);
    expect(after.spaces.audience).toBe("STAFF");
    expect(after.spaces.updatedBy).not.toBeNull();
  } finally {
    await restore(page, baseURL, { spaces: before.spaces.audience, onboarding: before.onboarding.audience });
  }
});

test("works without JavaScript, through the Everyone confirmation and back", async ({ browser, baseURL }) => {
  writesOnce();
  const context = await browser.newContext({ javaScriptEnabled: false, viewport: { width: 1440, height: 900 } });
  const page = await context.newPage();
  scriptless.add(page);
  await as(context, baseURL, staff);
  await open(page);
  const before = await stored(page.request);
  try {
    await restore(page, baseURL, { channels: "OFF", mentor_requests: "OFF" });
    await open(page);

    await press(row(page, "mentor_requests").getByRole("button", { name: "Set Mentor requests to Everyone" }));
    const confirm = page.locator("[data-flag-confirm='mentor_requests']");
    await expect(confirm).toContainText("This makes it visible to every signed-in user.");
    // Channels is Off, so the confirmation says what Everyone would leave unusable.
    await expect(confirm).toContainText("Mentor requests needs Channels, which is Off. Set Channels to Everyone too");
    expect((await stored(page.request)).mentor_requests.audience).toBe("OFF");

    await press(confirm.getByRole("button", { name: "Show Mentor requests to everyone" }));
    await expect(page.getByRole("status")).toHaveText(
      "Mentor requests is now Everyone: every signed-in user. Mentor requests needs Channels, which is Off. Set Channels to Everyone too, or Mentor requests won't work for everyone it is set for."
    );
    await expect(row(page, "mentor_requests")).toHaveAttribute("data-audience", "ALL");
    await expect(row(page, "mentor_requests").locator("[data-flag-warning]")).toBeVisible();
    expect((await stored(page.request)).mentor_requests.audience).toBe("ALL");
    await page.screenshot({ path: evidence("no-js-everyone"), fullPage: true });

    // Off applies at once, with no confirmation.
    await press(row(page, "mentor_requests").getByRole("button", { name: "Set Mentor requests to Off" }));
    await expect(page.getByRole("status")).toHaveText("Mentor requests is now Off: no one.");
    expect((await stored(page.request)).mentor_requests.audience).toBe("OFF");
  } finally {
    await restore(page, baseURL, { channels: before.channels.audience, mentor_requests: before.mentor_requests.audience });
    await context.close();
  }
});

test("refuses a form posted from another site", async ({ context, page, baseURL }) => {
  await as(context, baseURL, staff);
  await open(page);
  const before = await stored(page.request);
  const target = before.tembo_channels.audience === "STAFF" ? "OFF" : "STAFF";
  const forged = await page.request.post(PAGE, {
    form: { key: "tembo_channels", audience: target }, headers: { Origin: "https://example.com" }, maxRedirects: 0,
  });
  expect(forged.status()).toBe(403);
  expect((await stored(page.request)).tembo_channels.audience).toBe(before.tembo_channels.audience);
});

test("keeps the page and its settings from members who are not administrators", async ({ browser, page, baseURL }) => {
  test.skip(typeof member === "string", typeof member === "string" ? member : "");
  await as(page.context(), baseURL, staff);
  const before = await stored(page.request);
  const context = await browser.newContext();
  const theirs = await context.newPage();
  await as(context, baseURL, member);
  const origin = { Origin: new URL(baseURL!).origin };

  // The page sends a member back to their dashboard; the API refuses them outright.
  await theirs.goto(PAGE);
  await expect(theirs).toHaveURL(/\/dashboard(\/|$)/);
  // Tembo in channels: no test here writes it, so a change could only have come from the member.
  const posted = await theirs.request.post(PAGE, { form: { key: "tembo_channels", audience: "ALL", confirm: "ALL" }, headers: origin, maxRedirects: 0 });
  expect(posted.status()).toBe(302);
  expect(posted.headers().location).toMatch(/^\/dashboard/);
  expect((await theirs.request.get(API)).status()).toBe(403);
  expect((await theirs.request.put(`${API}/tembo_channels`, { data: { audience: "ALL" }, headers: origin })).status()).toBe(403);
  await context.close();

  expect((await stored(page.request)).tembo_channels).toEqual(before.tembo_channels);
});
