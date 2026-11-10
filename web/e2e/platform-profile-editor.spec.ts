import { mkdirSync } from "node:fs";
import { expect, test, type Page } from "@playwright/test";
import { runAxe } from "./platform-axe";
import { localPersonaSession, personaSession, signIn, type PersonaKey } from "./platform-personas";

/**
 * The one profile editor (/dashboard/me/portfolio, PR D), as the people it is for: a member without a
 * cohort makes a profile and posts work; a graduate lists themselves on the public website and takes
 * themselves off it. Every form is a plain post, so all of it runs without JavaScript here, with axe,
 * no sideways scroll and 44px targets checked on the way. Writes run against the local seed only.
 * Render-level detail is in src/pages/dashboard/_tests/portfolio.render.test.ts.
 */
const EVIDENCE_DIR = "test-results/evidence/platform-profile-editor";
mkdirSync(EVIDENCE_DIR, { recursive: true });
const PREVIEW = Boolean(process.env.PLAYWRIGHT_BASE_URL);
const PATH = "/dashboard/me/portfolio";
const EVERYONE_SEES = "Everyone signed in to TTV can see your profile and everything you post.";

const main = (page: Page) => page.locator("#spaces-main");
const evidence = (name: string) => `${EVIDENCE_DIR}/${test.info().project.name}-${name}.png`;

test.use({ reducedMotion: "reduce" });

async function signedIn(page: Page, baseURL: string | undefined, persona: PersonaKey) {
  const session = personaSession(persona);
  test.skip(typeof session === "string", typeof session === "string" ? session : "");
  if (typeof session === "string") return;
  await signIn(page.context(), baseURL!, session);
  test.skip((await page.request.get("/api/platform/me")).status() === 404, "The spaces flag is off here.");
}

async function open(page: Page, path: string, { script = true } = {}) {
  const response = await page.goto(path);
  expect(response?.status(), path).toBe(200);
  if (script && !PREVIEW) await page.addStyleTag({ content: "astro-dev-toolbar { display: none !important; }" });
}

async function noSidewaysScroll(page: Page) {
  expect(await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)).toBeLessThanOrEqual(0);
}

for (const persona of ["community", "alumna"] as const) {
  for (const width of [1440, 768, 390, 320]) {
    test(`reads as the style guide for the ${persona} at ${width}px: one title, says who sees it, axe clean`, async ({ page, baseURL }) => {
      await page.setViewportSize({ width, height: 900 });
      await signedIn(page, baseURL, persona);
      await open(page, PATH);
      expect(await page.evaluate(() => document.querySelectorAll("h1").length)).toBe(1);
      await expect(main(page).getByRole("heading", { level: 1 })).toHaveText("Your profile");
      await expect(main(page).locator("#profile-visibility")).toContainText(EVERYONE_SEES);
      await expect(main(page).locator("[data-variant='primary']")).toHaveCount(1);
      // The graduate gets a graduate's state, whichever her data gives (local seed: listed; preview: maybe no profile yet).
      await expect(main(page).locator("[data-public-site]")).toHaveAttribute(
        "data-public-site", persona === "alumna" ? /^(live|held|not-shown|waiting|unlisted|offered|save-first)$/ : "not-yet",
      );
      await noSidewaysScroll(page);
      await page.screenshot({ path: evidence(`${persona}-${width}`), fullPage: true });
      await runAxe(page, test.info(), `profile editor, ${persona}, ${width}`);
    });
  }
}

test.describe("on a touch screen", () => {
  test.use({ hasTouch: true, isMobile: true, viewport: { width: 390, height: 844 } });

  test("every control in the editor is at least 44px tall", async ({ page, baseURL }) => {
    await signedIn(page, baseURL, "alumna");
    await open(page, PATH);
    // Controls, not links inside a sentence (WCAG 2.5.8 leaves inline links to the text's own size).
    const controls = main(page).locator("[data-profile-form] :is(input:not([type='checkbox']), textarea, button), [data-public-site] :is(button, a[data-variant]), [data-work] :is(button, a[data-variant], a[data-row-action])");
    for (const control of await controls.all()) {
      if (!await control.isVisible()) continue;
      const box = await control.boundingBox();
      expect(box?.height ?? 0, await control.evaluate((element) => element.outerHTML.slice(0, 90))).toBeGreaterThanOrEqual(44);
    }
  });
});

test.describe("without JavaScript", () => {
  test.use({ javaScriptEnabled: false });

  test("a graduate takes themselves off the public website after a confirm step, and lists themselves again", async ({ page, baseURL }) => {
    test.skip(PREVIEW, "Writes run against the local seed only.");
    // A graduate of her own (e2e/platform-members.local.sql), so no other spec sees her listing change.
    const graduate = localPersonaSession("graduate");
    test.skip(typeof graduate === "string", typeof graduate === "string" ? graduate : "");
    if (typeof graduate === "string") return;
    const talent = "/talent/zawadi-mwende";
    const post = "/blog/zawadi-mwende/offline-first-fares";
    await page.setViewportSize({ width: 390, height: 844 });
    await signIn(page.context(), baseURL!, graduate);
    // Listed, with a post, and both in the sitemap.
    expect((await page.request.get(talent)).status()).toBe(200);
    expect((await page.request.get(post)).status()).toBe(200);
    expect(await (await page.request.get("/sitemap.xml")).text()).toContain(post);

    await open(page, PATH, { script: false });
    const site = main(page).locator("[data-public-site]");
    await site.getByRole("link", { name: "Take me off the public website" }).click();
    await expect(page).toHaveURL(new RegExp(`${PATH}\\?confirm=unpublish$`));
    await expect(site).toContainText(`Your page at ${talent} and your blog posts come off the public website, and Writing and Opportunities close until you list yourself again.`);
    await expect(site.locator("[data-notice='warning']")).toBeFocused();
    await page.screenshot({ path: evidence("unlist-confirm") });
    await site.getByRole("button", { name: "Take me off" }).click();
    await expect(page).toHaveURL((url) => url.pathname === PATH && url.search === "");
    await expect(main(page).locator("[data-notice='success']")).toContainText("You're off the public website");
    await expect(site).toHaveAttribute("data-public-site", "unlisted");
    // Off everything public: the page, the post and the sitemap. Still in the members directory, for everyone signed in.
    expect((await page.request.get(talent)).status()).toBe(404);
    expect((await page.request.get(post)).status()).toBe(404);
    expect(await (await page.request.get("/sitemap.xml")).text()).not.toContain("zawadi-mwende");
    expect((await page.request.get("/dashboard/community/members/zawadi-mwende")).status()).toBe(200);

    await site.getByRole("button", { name: "List me on the public website" }).click();
    await expect(main(page).locator("[data-notice='success']")).toContainText("You're on the public website");
    expect((await page.request.get(talent)).status()).toBe(200);
    expect((await page.request.get(post)).status()).toBe(200);
  });

  test("a member without a cohort posts work as a draft, posts it, and deletes it after a confirm step", async ({ page, baseURL }) => {
    test.skip(PREVIEW, "Writes run against the local seed only.");
    const newcomer = localPersonaSession("newcomer");
    test.skip(typeof newcomer === "string", typeof newcomer === "string" ? newcomer : "");
    if (typeof newcomer === "string") return;
    await page.setViewportSize({ width: 390, height: 844 });
    await signIn(page.context(), baseURL!, newcomer);
    await open(page, `${PATH}?add=1`, { script: false });
    const title = `Shamba water log ${Date.now()}`;
    const form = main(page).locator("[data-work-editor='add']");
    await form.getByLabel("Title").fill(title);
    await form.getByLabel("What you did").fill("Logged rainfall and pump hours for our shamba in a spreadsheet.");
    await form.getByLabel("When").fill("2026-10-12");
    await form.getByLabel("Keep it as a draft").check();
    await form.getByRole("button", { name: "Save" }).click();
    await expect(main(page).locator("[data-notice='success']")).toContainText("Saved as a draft");
    const entry = main(page).locator("[data-data-list-item]", { has: page.getByRole("heading", { level: 3, name: title }) });
    await expect(entry).toContainText("A draft: only you can see it.");

    await entry.getByRole("button", { name: `Post ${title}` }).click();
    await expect(main(page).locator("[data-notice='success']")).toContainText("Posted");
    await expect(entry.getByRole("button", { name: `Move to drafts ${title}` })).toBeVisible();

    await entry.getByRole("link", { name: `Delete ${title}` }).click();
    await expect(entry).toContainText(`Delete “${title}”?`);
    await entry.getByRole("button", { name: "Delete it" }).click();
    await expect(main(page).locator("[data-notice='success']")).toContainText("Deleted");
    await expect(main(page).getByRole("heading", { level: 3, name: title })).toHaveCount(0);
  });
});
