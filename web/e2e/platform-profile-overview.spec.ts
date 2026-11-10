import { mkdirSync } from "node:fs";
import { expect, test, type Browser, type BrowserContext, type Page } from "@playwright/test";
import { runAxe } from "./platform-axe";
import { personaSession, signIn, type PersonaKey } from "./platform-personas";

/**
 * T01: the Profile space opens on its Overview (prototype screens/07), and the editor is its own
 * entry, "Public profile". Checked as the people it is for: an alumna with a published profile, a
 * member without one (who is told what opens it and offered a cohort), and a mentor (framed as a
 * partner, never asked to apply). Then, as the alumna, the confirmation state of shared work: a
 * mentor confirms revision 1, she edits it, and the Overview says revision 2 waits for a mentor.
 *
 * Desktop at 1440x900 (chromium), phones at 390x844 (mobile-chromium). Local seed only
 * (`platform-personas.local.sql`, astro dev with PLATFORM_FLAGS_OVERRIDE=all and
 * PLATFORM_PERSONAS_LOCAL_SECRET): agent previews have no browser mentor.
 */

const OVERVIEW = "/dashboard/me";
const EDITOR = "/dashboard/me/portfolio";
const EVIDENCE_DIR = "test-results/evidence/platform-profile-overview";
mkdirSync(EVIDENCE_DIR, { recursive: true });

test.use({ reducedMotion: "reduce" });

test.beforeEach(async ({ page }, testInfo) => {
  test.skip(Boolean(process.env.PLAYWRIGHT_BASE_URL), "The personas are checked against the local seed only.");
  test.skip(typeof personaSession("mentor") === "string", "Set PLATFORM_PERSONAS_LOCAL_SECRET and apply platform-personas.local.sql.");
  if (testInfo.project.name === "mobile-chromium") await page.setViewportSize({ width: 390, height: 844 });
  else await page.setViewportSize({ width: 1440, height: 900 });
});

function evidence(name: string) {
  return `${EVIDENCE_DIR}/${test.info().project.name}-${name}.png`;
}

async function as(context: BrowserContext, baseURL: string, who: PersonaKey) {
  const session = personaSession(who);
  if (typeof session === "string") throw new Error(session);
  await signIn(context, baseURL, session);
}

async function open(page: Page, path: string) {
  const response = await page.goto(path);
  expect(response?.status(), path).toBe(200);
  await expect(page.locator("astro-island[ssr]")).toHaveCount(0);
  await page.addStyleTag({ content: "astro-dev-toolbar { display: none !important; }" });
  await page.evaluate(() => document.fonts.ready);
}

async function expectNoSidewaysScroll(page: Page) {
  const overflow = await page.evaluate(() => [document.documentElement, document.querySelector(".spaces-shell__main")]
    .filter((element): element is Element => element !== null)
    .map((element) => element.scrollWidth - element.clientWidth));
  for (const extra of overflow) expect(extra).toBeLessThanOrEqual(0);
}

/** The Profile sidebar's entries: on phones they live in the drawer, so read the links' names from the DOM. */
async function sidebarEntries(page: Page) {
  return page.locator("#space-sidebar a[href]:not([data-drawer-close])").evaluateAll((links) => links.map((link) => ({
    name: link.textContent?.replace(/\s+/g, " ").trim() ?? "",
    href: link.getAttribute("href"),
    current: link.getAttribute("aria-current") === "page",
  })));
}

const overview = (page: Page) => page.locator("[data-profile-overview]");

test("an alumna sees her published profile as visitors do, with the editor one click away", async ({ page, baseURL }) => {
  await as(page.context(), baseURL!, "alumna");
  await open(page, OVERVIEW);

  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Your profile");
  // The screen's one display heading (astro dev's own toolbar carries hidden ones).
  await expect(page.locator("h1:visible")).toHaveCount(1);
  const entries = await sidebarEntries(page);
  expect(entries.slice(0, 2)).toEqual([
    { name: "Overview", href: OVERVIEW, current: true },
    { name: "Public profile", href: EDITOR, current: false },
  ]);

  const card = overview(page).locator("[data-profile-card]");
  await expect(card.getByRole("heading", { level: 2, name: "Achieng Otieno" })).toBeVisible();
  await expect(card.locator("[data-chip]").first()).toHaveText("Published");
  await expect(card.locator("[data-profile-meta]")).toHaveText("Backend builder · Kisumu · Cohort 04");
  await expect(card.getByRole("list", { name: "Skills" }).getByRole("listitem")).toHaveText(["TypeScript", "SQL"]);
  await expect(overview(page).getByRole("link", { name: "View public page" })).toHaveAttribute("href", "/talent/achieng-otieno");
  await expect(overview(page).getByRole("link", { name: "See your member page" })).toHaveAttribute("href", "/dashboard/community/members/achieng-otieno");
  await expect(overview(page).getByRole("link", { name: "Edit", exact: true })).toHaveAttribute("href", EDITOR);

  const certificates = overview(page).getByRole("region", { name: "Certificates" });
  await expect(certificates.getByRole("link", { name: "View your Cohort 04 certificate" })).toHaveAttribute("href", /^\/certificate\//);
  await expect(overview(page).getByRole("region", { name: "Needs you" })).toBeVisible();
  await expect(overview(page).getByRole("region", { name: "Your work" })).toBeVisible();

  await expectNoSidewaysScroll(page);
  await page.screenshot({ path: evidence("alumna") });
  await runAxe(page, test.info(), "profile overview, alumna");

  // "Edit" opens the editor, in sentence case, with "Public profile" current.
  await overview(page).getByRole("link", { name: "Edit", exact: true }).click();
  await expect(page).toHaveURL(new RegExp(`${EDITOR}$`));
  await expect(page.getByRole("heading", { name: "Edit your profile" })).toBeVisible();
  await expect(page.getByText("Edit Your Profile", { exact: true })).toHaveCount(0);
  expect((await sidebarEntries(page)).find((entry) => entry.current)?.name).toBe("Public profile");
});

test("a form posted to the Overview from a tab opened before it existed goes on to the editor, body and all", async ({ page, baseURL }) => {
  test.skip(test.info().project.name !== "chromium", "The redirect is the same at every width.");
  await as(page.context(), baseURL!, "alumna");
  const response = await page.request.post(`${OVERVIEW}?from=old-tab`, {
    form: { _action: "save" }, headers: { Origin: new URL(baseURL!).origin }, maxRedirects: 0,
  });
  expect(response.status()).toBe(307);
  expect(response.headers().location).toBe(`${EDITOR}?from=old-tab`);
  // Reading the Overview stays a plain page.
  expect((await page.request.get(OVERVIEW, { maxRedirects: 0 })).status()).toBe(200);
});

test("a member without a public profile is told what opens it, and offered a cohort", async ({ page, baseURL }) => {
  await as(page.context(), baseURL!, "community");
  await open(page, OVERVIEW);

  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Your profile");
  const card = overview(page).locator("[data-profile-card=locked]");
  await expect(card.getByRole("heading", { level: 2 })).toHaveText("Your public builder page opens when you complete a cohort");
  await expect(card.getByRole("link", { name: "Apply to a cohort" })).toHaveAttribute("href", "/dashboard/cohort/apply");
  await expect(overview(page).getByRole("link", { name: "View public page" })).toHaveCount(0);
  await expect(overview(page).getByRole("link", { name: "See your member page" })).toHaveCount(0);
  await expect(overview(page).getByRole("link", { name: "Edit", exact: true })).toHaveCount(0);
  await expect(overview(page).getByRole("region", { name: "Opportunities for you" })).toHaveCount(0);
  await expect(overview(page).getByRole("region", { name: "Needs you" })).toContainText("Nothing needs you right now.");

  await expectNoSidewaysScroll(page);
  await page.screenshot({ path: evidence("member-without-profile") });
  await runAxe(page, test.info(), "profile overview, member without a profile");
});

test("a mentor's overview frames the profile for a partner, and never asks them to apply", async ({ page, baseURL }) => {
  await as(page.context(), baseURL!, "mentor");
  await open(page, OVERVIEW);

  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Your profile");
  await expect(overview(page).getByRole("region", { name: "Public profiles come with a cohort" })).toBeVisible();
  await expect(page.getByRole("link", { name: /^Apply to a cohort/ })).toHaveCount(0);
  await expect(overview(page).locator("[data-profile-card]")).toHaveCount(0);

  await expectNoSidewaysScroll(page);
  await page.screenshot({ path: evidence("mentor") });
  await runAxe(page, test.info(), "profile overview, mentor");
});

test.describe("shared work and its confirmations", () => {
  test.describe.configure({ mode: "serial" });

  test.beforeEach(() => {
    test.skip(test.info().project.name !== "chromium", "One project at a time: both share the local database.");
  });

  async function newPage(browser: Browser, baseURL: string, who: PersonaKey) {
    const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    await as(context, baseURL, who);
    return context.newPage();
  }

  /** A same-origin JSON write, as the community app makes it. */
  async function write(page: Page, baseURL: string, method: string, path: string, data: unknown) {
    const response = await page.request.fetch(`${baseURL}/api/community/${path}`, {
      method, data, headers: { Origin: new URL(baseURL).origin, "Content-Type": "application/json" },
    });
    expect(response.ok(), `${method} ${path}: ${response.status()}`).toBe(true);
    return response.json() as Promise<Record<string, { id: string; version: number } | undefined>>;
  }

  test("the overview says which revision a mentor confirmed, and that a newer one waits", async ({ browser, baseURL }) => {
    const alumna = await newPage(browser, baseURL!, "alumna");
    const mentor = await newPage(browser, baseURL!, "mentor");
    const title = `T01 ledger ${Date.now()}`;
    const fields = { title, description: "Fictional: M-Pesa receipts into a shared ledger.", occurredAt: "2026-10-12", status: "posted" };
    const { entry } = await write(alumna, baseURL!, "POST", "journey", fields);
    try {
      await write(mentor, baseURL!, "POST", `journey/${entry!.id}/confirmations`, {
        expectedRevision: 1, statement: "I reviewed the ledger code with Achieng.", method: "Code review",
      });
      await open(alumna, OVERVIEW);
      const row = overview(alumna).locator("[data-profile-project]").filter({ hasText: title });
      await expect(row.locator("[data-profile-project-state]")).toHaveText("Confirmed by David Kamau");

      await write(alumna, baseURL!, "PUT", `journey/${entry!.id}`, { ...fields, description: "Fictional: now with reconciliation.", expectedRevision: 1 });
      await open(alumna, OVERVIEW);
      await expect(row.locator("[data-profile-project-state]")).toHaveText("David Kamau confirmed revision 1");
      await expect(row).toContainText("revision 2");
      const need = overview(alumna).getByRole("region", { name: "Needs you" }).getByRole("listitem").filter({ hasText: title });
      await expect(need).toHaveText(new RegExp(`${title}: revision 2 isn't confirmed yet`));
      await expect(need.getByRole("link")).toHaveAccessibleName(/^(Open|Ask a mentor)/);
      await alumna.screenshot({ path: evidence("alumna-revision-waits") });
      await runAxe(alumna, test.info(), "profile overview, newer revision");
    } finally {
      await write(alumna, baseURL!, "DELETE", `journey/${entry!.id}`, {});
      await alumna.context().close();
      await mentor.context().close();
    }
  });
});
