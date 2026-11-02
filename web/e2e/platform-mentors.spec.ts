import { expect, test, type Page } from "@playwright/test";
import { runAxe } from "./platform-axe";

/**
 * Mentor connections (U-4.1 / S-4.1) on the DEV-only harness `/dev/platform-mentors`: the real
 * directory, request drawer, mentor queue and availability editor inside SpacesLayout, over the
 * stateful mentoring mock (S-4.1). Screens 05 and 06 at 390 and 1440, axe, the keyboard path,
 * optimistic moves that roll back, the drawer without JavaScript, an account that cannot ask, and
 * the flag off. `platform-mentor-requests.spec.ts` runs the same journeys against B-4.1.
 */
const HARNESS = "/dev/platform-mentors";
const EVIDENCE_DIR = "test-results/evidence/platform-mentors";
const PHONE = { width: 390, height: 844 };
const DESKTOP = { width: 1440, height: 900 };
const DAVID = "s00000000000000000000003";
const SAMUEL = "s00000000000000000000011";

function harness(params: Record<string, string> = {}) {
  return `${HARNESS}?${new URLSearchParams({ persona: "wanjiku", latency: "150", ...params })}`;
}

async function open(page: Page, path: string) {
  await page.route(/fonts\.(googleapis|gstatic)\.com/, (route) => route.abort());
  await page.goto(path);
  await expect(page.locator("astro-island[ssr]")).toHaveCount(0);
  await page.waitForFunction(() => typeof window.__mentorsHarness?.refuseWrites === "function");
}

const horizontalOverflow = (page: Page) => page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
const card = (page: Page, name: string) => page.locator("[data-mentor-card]").filter({ has: page.getByRole("heading", { name }) });
const drawerFor = (page: Page, first: string) => page.getByRole("dialog", { name: `Ask ${first} for time` });
const NOTE = { name: "What would you like help with?" };

// The harness exists only in astro dev; deployed builds prove it absent in platform-space-routes.spec.ts.
test.skip(Boolean(process.env.PLAYWRIGHT_BASE_URL), "The harness exists only in astro dev.");
// Each test sets its own viewport, so one project runs them.
test.beforeEach(({ browserName }, testInfo) => {
  test.skip(testInfo.project.name !== "chromium", `covered by the chromium project (${browserName})`);
});
test.use({ reducedMotion: "reduce" });

for (const viewport of [DESKTOP, PHONE]) {
  test(`directory and request drawer (screen 05) at ${viewport.width}px`, async ({ page }, testInfo) => {
    await page.setViewportSize(viewport);
    await open(page, harness({ view: "directory" }));
    await expect(page.getByRole("heading", { level: 1, name: "Mentors" })).toBeVisible();
    await expect(card(page, "Mercy Wambui")).toContainText("Full this month");
    await expect(card(page, "Mercy Wambui").getByRole("button")).toHaveCount(0);
    expect(await horizontalOverflow(page)).toBe(0);
    await page.screenshot({ path: `${EVIDENCE_DIR}/05-directory-${viewport.width}.png`, fullPage: true });
    await runAxe(page, testInfo, `directory-${viewport.width}`);

    await card(page, "David Kamau").getByRole("button", { name: "Ask for time" }).click();
    const drawer = drawerFor(page, "David");
    await expect(drawer.getByRole("textbox", NOTE)).toBeFocused();
    await expect(page).toHaveURL(new RegExp(`ask=${DAVID}`));
    expect(await horizontalOverflow(page)).toBe(0);
    await page.screenshot({ path: `${EVIDENCE_DIR}/05-drawer-${viewport.width}.png` });
    await runAxe(page, testInfo, `drawer-${viewport.width}`);
  });
}

test("the keyboard reaches a mentor, opens the drawer, sends, and comes back to the button", async ({ page }) => {
  await page.setViewportSize(DESKTOP);
  await open(page, harness({ view: "directory" }));
  // Wanjiku is already waiting on David in the fixtures, so she asks Samuel.
  const button = card(page, "Samuel Otieno").getByRole("button", { name: "Ask for time" });
  for (let presses = 0; presses < 60 && !(await button.evaluate((el) => el === document.activeElement)); presses += 1) {
    await page.keyboard.press("Tab");
  }
  await expect(button).toBeFocused();
  await page.keyboard.press("Enter");
  const drawer = drawerFor(page, "Samuel");
  await expect(drawer.getByRole("textbox", NOTE)).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(drawer).toBeHidden();
  await expect(button).toBeFocused();

  await page.keyboard.press("Enter");
  await drawer.getByRole("textbox", NOTE).fill("Could you look at how my Android app syncs when it comes back online?");
  await drawer.getByRole("radio", { name: /Written review/ }).check();
  await drawer.getByRole("button", { name: "Send request" }).click();
  await expect(drawer.getByRole("heading", { name: "Request sent" })).toBeFocused();
  await drawer.getByRole("button", { name: "Done" }).click();
  await expect(page.locator("[data-own-request]").filter({ hasText: "Samuel Otieno" }).first()).toContainText("Waiting for Samuel");
});

test("withdrawing shows at once and puts the request back when the server refuses", async ({ page }) => {
  await page.setViewportSize(DESKTOP);
  await open(page, harness({ view: "directory" }));
  const row = page.locator("[data-own-request][data-status=PENDING]").first();
  await expect(row).toBeVisible();
  await page.evaluate(() => window.__mentorsHarness!.refuseWrites(1, 503, "unavailable"));
  await row.getByRole("button", { name: "Withdraw" }).click();
  await expect(page.locator("[data-own-request][data-status=PENDING]")).toHaveCount(1);
  await expect(page.locator("[data-own-requests]")).toContainText("Couldn't withdraw. Nothing changed; try again.");

  await page.locator("[data-own-request][data-status=PENDING]").first().getByRole("button", { name: "Withdraw" }).click();
  await expect(page.locator("[data-own-request][data-status=WITHDRAWN]")).toHaveCount(1);
});

test("asking without having agreed to the habits keeps the note and comes back to the drawer", async ({ page }) => {
  await page.setViewportSize(DESKTOP);
  await open(page, harness({ view: "directory", conduct: "required" }));
  await card(page, "Samuel Otieno").getByRole("button", { name: "Ask for time" }).click();
  const drawer = drawerFor(page, "Samuel");
  await drawer.getByRole("textbox", NOTE).fill("A review of my ledger's data model?");
  await drawer.getByRole("radio", { name: /Written review/ }).check();
  await drawer.getByRole("button", { name: "Send request" }).click();
  await expect(drawer.getByRole("heading", { name: "First, how we talk to each other" })).toBeVisible();
  await drawer.getByRole("button", { name: "I agree" }).click();
  await expect(page.locator("astro-island[ssr]")).toHaveCount(0);
  await expect(drawerFor(page, "Samuel").getByRole("textbox", NOTE)).toHaveValue("A review of my ledger's data model?");
});

for (const viewport of [DESKTOP, PHONE]) {
  test(`the mentor's requests (screen 06) at ${viewport.width}px: accept, and a decline that rolls back`, async ({ page }, testInfo) => {
    await page.setViewportSize(viewport);
    await open(page, harness({ persona: "david", view: "requests" }));
    await expect(page.getByRole("heading", { level: 1, name: "Requests" })).toBeVisible();
    const waiting = page.locator("[data-mentor-request][data-status=PENDING]");
    await expect(waiting.first()).toBeVisible();
    const count = await waiting.count();
    expect(await horizontalOverflow(page)).toBe(0);
    await page.screenshot({ path: `${EVIDENCE_DIR}/06-requests-${viewport.width}.png`, fullPage: true });
    await runAxe(page, testInfo, `requests-${viewport.width}`);

    await page.evaluate(() => window.__mentorsHarness!.refuseWrites(1, 503, "unavailable"));
    await waiting.first().getByRole("button", { name: "Not this month" }).click();
    await expect(waiting).toHaveCount(count);

    await waiting.first().getByRole("button", { name: "Accept" }).click();
    await expect(page.locator("[data-mentor-request][data-status=ACCEPTED]").first().getByRole("link", { name: /Open conversation/ })).toBeVisible();
    await expect(waiting).toHaveCount(count - 1);
  });

  test(`availability editor at ${viewport.width}px`, async ({ page }, testInfo) => {
    await page.setViewportSize(viewport);
    await open(page, harness({ persona: "david", view: "availability" }));
    const editor = page.locator("[data-availability-editor]");
    await expect(editor).toBeVisible();
    expect(await horizontalOverflow(page)).toBe(0);
    await page.screenshot({ path: `${EVIDENCE_DIR}/06-availability-${viewport.width}.png`, fullPage: true });
    await runAxe(page, testInfo, `availability-${viewport.width}`);

    await editor.getByRole("switch", { name: "Pause new requests" }).check();
    await editor.getByRole("button", { name: "Save availability" }).click();
    await expect(editor.locator("[data-availability-saved]")).toBeVisible();
    await expect(editor.locator("[data-listing]")).toContainText("Not in the mentor directory");
  });
}

test.describe("without JavaScript", () => {
  test.use({ javaScriptEnabled: false });

  test("the drawer is a form: a note to fix comes back with what was written, and a send lands on the directory", async ({ page }) => {
    await page.setViewportSize(PHONE);
    await page.goto(harness({ view: "directory", ask: SAMUEL }));
    const panel = page.locator("[data-mentor-drawer-static]");
    await expect(panel).toBeVisible();
    // The sheet scrolls inside itself; at its end "Send request" stands clear of the bottom bar (click hit-tests it).
    const send = panel.getByRole("button", { name: "Send request" });
    await send.scrollIntoViewIfNeeded();
    await expect(send).toBeInViewport();
    expect(await send.evaluate((el) => {
      const box = el.getBoundingClientRect();
      return el.contains(document.elementFromPoint(box.left + box.width / 2, box.top + box.height / 2));
    })).toBe(true);
    await page.screenshot({ path: `${EVIDENCE_DIR}/05-drawer-no-js-${PHONE.width}.png` });
    await send.click();
    await expect(page.locator("[data-mentor-drawer-static]")).toBeVisible();
    await expect(page).toHaveTitle(/^Error: /);

    await page.locator("[data-mentor-drawer-static]").getByRole("textbox", NOTE).fill("Could we look at my API's error responses?");
    await page.locator("[data-mentor-drawer-static]").getByRole("radio", { name: /Written review/ }).check();
    await page.locator("[data-mentor-drawer-static]").getByRole("button", { name: "Send request" }).click();
    await expect(page).toHaveURL(/[?&]sent=/);
    await expect(page.locator("[data-mentor-drawer-static]")).toHaveCount(0);
  });
});

test("an account without a profile or cohort place reads the directory, with no way to ask", async ({ page }, testInfo) => {
  await page.setViewportSize(PHONE);
  await open(page, harness({ view: "directory", member: "no" }));
  await expect(page.locator("[data-mentor-card]").first()).toBeVisible();
  await expect(page.getByRole("button", { name: "Ask for time" })).toHaveCount(0);
  await expect(page.locator("[data-mentors-need-member]")).toContainText("Asking a mentor for time needs a member profile or a cohort place.");
  await page.screenshot({ path: `${EVIDENCE_DIR}/05-not-a-member-${PHONE.width}.png`, fullPage: true });
  await runAxe(page, testInfo, "directory-not-a-member");
});

test("with mentor_requests off, none of these pages exist", async ({ page }) => {
  for (const view of ["directory", "requests", "availability"]) {
    const response = await page.goto(harness({ persona: view === "directory" ? "wanjiku" : "david", view, flag: "off" }));
    expect(response?.status(), view).toBe(404);
  }
});
