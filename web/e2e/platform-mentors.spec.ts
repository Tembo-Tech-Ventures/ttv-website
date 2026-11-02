import { mkdirSync } from "node:fs";
import { expect, test, type Page } from "@playwright/test";
import { runAxe } from "./platform-axe";

/**
 * The browser contract for mentor connections (U-4.1/S-4.1) on the DEV-only
 * harness `/dev/platform-mentors`: the real directory, request drawer,
 * requests queue and availability editor over the stateful mentoring mock, at
 * 1440 and 390. The same journeys against the real backend are in
 * platform-mentor-requests.spec.ts.
 */
const HARNESS = "/dev/platform-mentors";
const EVIDENCE_DIR = "test-results/evidence/platform-mentors";
const SIZES = [
  { width: 1440, height: 900 },
  { width: 390, height: 844 },
] as const;

/** Chromium in the dev container cannot reach Google Fonts itself; Node can. */
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

async function open(page: Page, query: string) {
  await routeFonts(page);
  const response = await page.goto(`${HARNESS}?${query}`);
  expect(response?.status(), query).toBe(200);
  await expect(page.locator("astro-island[ssr]")).toHaveCount(0);
  await page.evaluate(() => document.fonts.ready);
}

async function noHorizontalScroll(page: Page) {
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBeLessThanOrEqual(0);
}

const card = (page: Page, name: string) => page.locator("[data-mentor-card]").filter({ has: page.getByRole("heading", { name }) });
const queueCard = (page: Page, name: string) => page.locator("[data-mentor-request]").filter({ has: page.getByRole("heading", { name }) }).first();

test.use({ reducedMotion: "reduce" });

test.beforeEach(({ baseURL }) => {
  test.skip(Boolean(process.env.PLAYWRIGHT_BASE_URL), "The harness exists only under astro dev.");
  expect(baseURL).toBeTruthy();
  mkdirSync(EVIDENCE_DIR, { recursive: true });
});

for (const size of SIZES) {
  test.describe(`at ${size.width}`, () => {
    test.use({ viewport: size, hasTouch: size.width < 1024, isMobile: size.width < 1024 });

    test("the directory reads, filters by link, and a full mentor has nothing to press", async ({ page }, testInfo) => {
      await open(page, "persona=wanjiku&view=directory");
      await expect(page.getByRole("heading", { level: 1, name: "Mentors" })).toBeVisible();
      await expect(card(page, "David Kamau")).toContainText("2 of 3 spots open in November");
      await expect(card(page, "Mercy Wambui")).toContainText("Full this month");
      await expect(card(page, "Mercy Wambui").getByRole("link", { name: "Ask for time" })).toHaveCount(0);
      await noHorizontalScroll(page);
      await page.screenshot({ path: `${EVIDENCE_DIR}/directory-${size.width}.png`, fullPage: true });
      await runAxe(page, testInfo, `directory-${size.width}`);

      await page.getByRole("link", { name: "Has open spots" }).click();
      await expect(page).toHaveURL(/available=true/);
      await expect(card(page, "Mercy Wambui")).toHaveCount(0);
    });

    test("the drawer opens from the keyboard, keeps focus inside, and gives it back", async ({ page }, testInfo) => {
      await open(page, "persona=wanjiku&view=directory");
      const ask = card(page, "David Kamau").getByRole("link", { name: "Ask for time" });
      await ask.focus();
      await page.keyboard.press("Enter");
      const drawer = page.getByRole("dialog", { name: "Ask David for time" });
      await expect(drawer).toBeVisible();
      await expect(page).toHaveURL(/ask=/);
      await expect(drawer.getByRole("textbox", { name: "What would you like help with?" })).toBeFocused();
      await drawer.getByRole("textbox", { name: "What would you like help with?" }).fill("Could you review how I retry a failed callback?");
      await noHorizontalScroll(page);
      await page.screenshot({ path: `${EVIDENCE_DIR}/drawer-${size.width}.png` });
      await runAxe(page, testInfo, `drawer-${size.width}`);
      await page.keyboard.press("Escape");
      await expect(drawer).toBeHidden();
      await expect(ask).toBeFocused();
      await expect(page).not.toHaveURL(/ask=/);

      // The note waits in the tab: opening the drawer again finds it.
      await ask.click();
      await expect(drawer.getByRole("textbox", { name: "What would you like help with?" })).toHaveValue("Could you review how I retry a failed callback?");
    });

    test("an account without a profile or a cohort place reads the directory, with neutral copy", async ({ page }, testInfo) => {
      await open(page, "persona=joseph&view=directory&member=no");
      await expect(page.locator("[data-mentors-browse-only]")).toHaveText(
        "You can read about every mentor here. Asking a mentor for time needs a member profile or a cohort place.",
      );
      await expect(page.getByRole("link", { name: "Ask for time" })).toHaveCount(0);
      await noHorizontalScroll(page);
      await page.screenshot({ path: `${EVIDENCE_DIR}/directory-not-member-${size.width}.png`, fullPage: true });
      await runAxe(page, testInfo, `directory-not-member-${size.width}`);
    });

    test("a mentor's requests: the month, Worth another look, and an answer put back when refused", async ({ page }, testInfo) => {
      await open(page, "persona=david&view=requests");
      await expect(page.getByRole("heading", { level: 1, name: "Requests" })).toBeVisible();
      await expect(page.locator("[data-spots-used]")).toHaveText("1 of 3");
      const another = page.locator("[data-another-look]");
      await expect(another).toContainText("Achieng shared revision 3 of Chama ledger");
      await expect(another.getByRole("link", { name: /Review revision 3/ })).toHaveAttribute("href", "/dashboard/mentoring/confirm");
      await noHorizontalScroll(page);
      await page.screenshot({ path: `${EVIDENCE_DIR}/requests-${size.width}.png`, fullPage: true });
      await runAxe(page, testInfo, `requests-${size.width}`);

      const request = queueCard(page, "Wanjiku Mwangi");
      await page.evaluate(() => window.__mentorsHarness!.refuseWrites(1, 503, "server"));
      await request.getByRole("button", { name: "Not this month" }).click();
      await expect(request).toContainText("That didn't go through, so nothing changed.");
      await expect(request).toHaveAttribute("data-status", "PENDING");
      await expect(page.locator("[data-spots-used]")).toHaveText("1 of 3");

      await request.getByRole("button", { name: "Accept" }).click();
      await expect(request).toHaveAttribute("data-status", "ACCEPTED");
      await expect(request.getByRole("link", { name: /Open conversation with Wanjiku/ })).toBeVisible();
    });

    test("the availability editor reads and saves", async ({ page }, testInfo) => {
      await open(page, "persona=david&view=availability");
      await expect(page.getByRole("heading", { level: 1, name: "Availability" })).toBeVisible();
      await noHorizontalScroll(page);
      await page.screenshot({ path: `${EVIDENCE_DIR}/availability-${size.width}.png`, fullPage: true });
      await runAxe(page, testInfo, `availability-${size.width}`);
      await page.getByRole("switch", { name: /Pause new requests/ }).click();
      await page.getByRole("button", { name: "Save availability" }).click();
      await expect(page.locator("[data-availability-saved]")).toBeVisible();
      await expect(page.locator("[data-listing]")).toHaveAttribute("data-listing", "unlisted");
    });
  });
}

test("with mentor_requests off, none of these pages exist", async ({ page }) => {
  for (const query of ["persona=wanjiku&view=directory", "persona=david&view=requests", "persona=david&view=availability"]) {
    expect((await page.request.get(`${HARNESS}?${query}&flag=off`)).status(), query).toBe(404);
  }
});
