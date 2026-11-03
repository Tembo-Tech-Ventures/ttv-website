import { mkdirSync } from "node:fs";
import { expect, test, type Page } from "@playwright/test";
import { runAxe } from "./platform-axe";
import { personaSession, signIn, type PersonaKey } from "./platform-personas";

/**
 * T02: admin inside the spaces shell. Admin Home and Moderation render in the Admin space, with
 * the space tabs, search and the bell, and the admin navigation as the space's sidebar, so moving
 * between a channel and Moderation keeps them. The pages that have not moved yet keep the existing
 * admin shell. The middleware's ADMIN guard is unchanged: nobody else reaches either page.
 *
 * Desktop at 1440x900 (chromium), phones at 390x844 (mobile-chromium). Local seed only
 * (`platform-personas.local.sql`, astro dev with PLATFORM_FLAGS_OVERRIDE=all and
 * PLATFORM_PERSONAS_LOCAL_SECRET).
 */

const EVIDENCE_DIR = "test-results/evidence/platform-admin-space";
mkdirSync(EVIDENCE_DIR, { recursive: true });

test.use({ reducedMotion: "reduce" });

test.beforeEach(async ({ page }, testInfo) => {
  test.skip(Boolean(process.env.PLAYWRIGHT_BASE_URL), "The personas are checked against the local seed only.");
  test.skip(typeof personaSession("staff") === "string", "Set PLATFORM_PERSONAS_LOCAL_SECRET and apply platform-personas.local.sql.");
  if (testInfo.project.name === "mobile-chromium") await page.setViewportSize({ width: 390, height: 844 });
  else await page.setViewportSize({ width: 1440, height: 900 });
});

function wide(page: Page) {
  return (page.viewportSize()?.width ?? 0) >= 1024;
}

function evidence(name: string) {
  return `${EVIDENCE_DIR}/${test.info().project.name}-${name}.png`;
}

async function as(page: Page, baseURL: string, who: PersonaKey) {
  const session = personaSession(who);
  if (typeof session === "string") throw new Error(session);
  await signIn(page.context(), baseURL, session);
}

async function open(page: Page, path: string) {
  const response = await page.goto(path);
  expect(response?.status(), path).toBe(200);
  // A cold dev server compiles each island on first use.
  await expect(page.locator("astro-island[ssr]")).toHaveCount(0, { timeout: 30_000 });
  await page.addStyleTag({ content: "astro-dev-toolbar { display: none !important; }" });
  await page.evaluate(() => document.fonts.ready);
}

/** The space tabs at this width: the card-file tabs on desktop, the bottom bar on phones. */
const tabs = (page: Page) => page.locator(wide(page) ? ".space-file__nav" : ".spaces-bottom");

/** In the Admin space: its tab current, search and the bell in the top bar, its sidebar current entry, one display heading. */
async function expectAdminSpace(page: Page, heading: string, current: string) {
  await expect(page.locator(".spaces-shell")).toHaveAttribute("data-space", "admin");
  await expect(tabs(page).locator("[aria-current='page']")).toContainText("Admin");
  await expect(page.getByRole("button", { name: /^Search/ })).toBeVisible();
  await expect(page.getByRole("button", { name: /^Attention/ })).toBeVisible();
  await expect(page.locator("#spaces-main h1")).toHaveText(heading);
  await expect(page.locator("#space-sidebar a[aria-current='page']")).toHaveText(new RegExp(`^${current}`));
  const overflow = await page.evaluate(() => [document.documentElement, document.querySelector(".spaces-shell__main")]
    .filter((element): element is Element => element !== null)
    .map((element) => element.scrollWidth - element.clientWidth));
  for (const extra of overflow) expect(extra).toBeLessThanOrEqual(0);
}

test("an admin moves from a channel to Moderation and back without leaving the spaces shell", async ({ page, baseURL }) => {
  await as(page, baseURL!, "staff");
  await open(page, "/dashboard/community/c/help");
  await expect(page.locator(".spaces-shell")).toHaveAttribute("data-space", "community");

  await tabs(page).getByRole("link", { name: /Admin/ }).click();
  await expect(page).toHaveURL(/\/admin$/);
  await expectAdminSpace(page, "Admin home", "Admin home");
  await page.screenshot({ path: evidence("admin-home") });
  await runAxe(page, test.info(), "admin home in the Admin space");

  await open(page, "/admin/moderation");
  await expectAdminSpace(page, "Moderation", "Moderation");
  await expect(page.getByText("Contact details are hidden from other members until you decide; everything else stays visible.")).toBeVisible();
  await page.screenshot({ path: evidence("moderation") });
  await runAxe(page, test.info(), "moderation in the Admin space");

  await tabs(page).getByRole("link", { name: /Community/ }).click();
  await expect(page.locator(".spaces-shell")).toHaveAttribute("data-space", "community");
});

test("the Admin space's sidebar is the admin navigation, and its Moderation count follows the queue", async ({ page, baseURL }) => {
  test.skip(!wide(page), "The sidebar is a drawer on phones; its links are the same.");
  await as(page, baseURL!, "staff");
  await open(page, "/admin/moderation");
  const sidebar = page.locator("#space-sidebar");
  for (const [name, href] of [["Access requests", "/admin/access-requests"], ["Users", "/admin/users"], ["Feature flags", "/admin/platform-flags"]]) {
    await expect(sidebar.getByRole("link", { name: new RegExp(`^${name}`) })).toHaveAttribute("href", href);
  }
  await expect(sidebar.getByRole("link", { name: "Back to dashboard" })).toHaveCount(0);
  await expect(sidebar.getByRole("link", { name: "Logout" })).toHaveCount(0);

  // A decision swapped in place reports the queue's new count (enhance.ts); the badge follows it.
  const badge = sidebar.getByRole("link", { name: /^Moderation/ }).locator("[data-count-badge]");
  await expect(badge).toBeVisible();
  const notes = Number(await page.locator("[data-admin-space]").getAttribute("data-request-notes"));
  await page.evaluate(() => document.dispatchEvent(new CustomEvent("ttv:moderation-pending", { detail: 2 })));
  await expect(badge).toContainText(`${2 + notes} waiting`);
  if (notes === 0) {
    await page.evaluate(() => document.dispatchEvent(new CustomEvent("ttv:moderation-pending", { detail: 0 })));
    await expect(badge).toBeHidden();
  }
});

test("admin pages that have not moved yet keep the existing admin shell", async ({ page, baseURL }) => {
  test.skip(!wide(page), "One width is enough for the unchanged shell.");
  await as(page, baseURL!, "staff");
  await open(page, "/admin/users");
  await expect(page.locator(".spaces-shell")).toHaveCount(0);
  await expect(page.getByRole("link", { name: "Back to dashboard" })).toBeVisible();
});

test.describe("staff only", () => {
  for (const who of ["student", "alumna", "mentor", "community", "institution"] as const) {
    test(`${who}: neither admin page opens, and there is no Admin tab`, async ({ page, baseURL }) => {
      test.skip(!wide(page), "Access is the same at every width.");
      await as(page, baseURL!, who);
      for (const path of ["/admin", "/admin/moderation"]) {
        const response = await page.request.get(path, { maxRedirects: 0 });
        expect([302, 303], `${who} ${path}`).toContain(response.status());
        expect(new URL(response.headers().location!, baseURL).pathname, `${who} ${path}`).toBe("/dashboard");
      }
      await open(page, "/dashboard/community");
      await expect(tabs(page).getByRole("link", { name: /Admin/ })).toHaveCount(0);
    });
  }

  test("signed out: both pages send you to sign in", async ({ page }) => {
    test.skip(!wide(page), "Access is the same at every width.");
    for (const path of ["/admin", "/admin/moderation"]) {
      const response = await page.request.get(path, { maxRedirects: 0 });
      expect([302, 303], path).toContain(response.status());
      expect(response.headers().location, path).toMatch(/\/auth\/login/);
    }
  });
});
