import { mkdirSync } from "node:fs";
import { expect, test, type Locator, type Page } from "@playwright/test";
import { runAxe } from "./platform-axe";
import { personaSession, signIn, type PersonaKey } from "./platform-personas";

/**
 * Community → Members (semi-public member directory, PR C): everyone with a saved profile, for
 * everyone signed in, and each member's page with their posted work. Server pages with no island:
 * the search is a GET form, so it works without JavaScript; the whole card opens the profile; a
 * handle the caller can't see is a 404 like one nobody has. Institutions see the same pages.
 *
 * Against the local seed (e2e/platform-personas.local.sql): Achieng Otieno (the alumna) has a saved
 * profile and is on the public website; Lucy Chebet (community) and Joseph Mutua (institution) are
 * not listed. Render-level detail is in src/pages/dashboard/community/_tests/members.render.test.ts.
 */
const EVIDENCE_DIR = "test-results/evidence/platform-members";
mkdirSync(EVIDENCE_DIR, { recursive: true });
const PREVIEW = Boolean(process.env.PLAYWRIGHT_BASE_URL);
const PATH = "/dashboard/community/members";
const ACHIENG = `${PATH}/achieng-otieno`;

const main = (page: Page) => page.locator("#spaces-main");
const evidence = (name: string) => `${EVIDENCE_DIR}/${test.info().project.name}-${name}.png`;

test.use({ reducedMotion: "reduce" });

async function signedIn(page: Page, baseURL: string | undefined, persona: PersonaKey = "community") {
  const session = personaSession(persona);
  test.skip(typeof session === "string", typeof session === "string" ? session : "");
  if (typeof session === "string") return;
  await signIn(page.context(), baseURL!, session);
  test.skip((await page.request.get("/api/platform/me")).status() === 404, "The spaces flag is off here.");
}

/** `script: false` in a context without JavaScript, where addStyleTag hangs. */
async function open(page: Page, path: string, { script = true } = {}) {
  const response = await page.goto(path);
  expect(response?.status(), path).toBe(200);
  if (script && !PREVIEW) await page.addStyleTag({ content: "astro-dev-toolbar { display: none !important; }" });
}

async function noSidewaysScroll(page: Page) {
  expect(await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)).toBeLessThanOrEqual(0);
}

const cards = (page: Page) => main(page).locator("[data-member-card]");
const card = (page: Page, handle: string) => main(page).locator(`[data-member-card="${handle}"]`);

for (const width of [1440, 768, 390, 320]) {
  test(`the directory reads as the style guide at ${width}px: one title, cards, no sideways scroll, axe clean`, async ({ page, baseURL }) => {
    await page.setViewportSize({ width, height: 900 });
    await signedIn(page, baseURL);
    await open(page, PATH);
    await expect(main(page).getByRole("heading", { level: 1 })).toHaveText("Members");
    await expect(page.locator("h1")).toHaveCount(1);
    await expect(main(page).getByRole("search", { name: "Find members" })).toBeVisible();
    await expect(main(page).locator("#member-results")).toHaveText(/^\d+ members?$/);
    await expect(cards(page).first()).toBeVisible();
    await expect(main(page).locator("[data-member-you]")).toBeVisible();
    await noSidewaysScroll(page);
    await page.screenshot({ path: evidence(`directory-${width}`), fullPage: true });
    await runAxe(page, test.info(), `members directory ${width}`);
  });
}

test("the whole card opens the member's page, which shows their work and their public page", async ({ page, baseURL }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await signedIn(page, baseURL);
  await open(page, PATH);
  const achieng = card(page, "achieng-otieno");
  test.skip(await achieng.count() === 0, "Achieng is on a later page here.");
  // A press on the card away from the name (here, its facts at the foot) follows the name's link.
  const box = (await achieng.boundingBox())!;
  await achieng.click({ position: { x: box.width / 2, y: box.height - 20 } });
  await expect(page).toHaveURL(new RegExp(`${ACHIENG}$`));
  await expect(main(page).getByRole("heading", { level: 1 })).toHaveText("Achieng Otieno");
  await expect(main(page).getByRole("heading", { level: 2, name: "Work" })).toBeVisible();
  await expect(main(page).locator("[data-member-public]")).toHaveAttribute("href", "/talent/achieng-otieno");
  await expect(main(page).getByRole("link", { name: "Members" }).first()).toHaveAttribute("href", PATH);
  // Someone else's page offers no editor and no peach action.
  await expect(main(page).locator("[data-variant='primary']")).toHaveCount(0);
  await noSidewaysScroll(page);
  await page.screenshot({ path: evidence("profile-1440"), fullPage: true });
  await runAxe(page, test.info(), "member profile 1440");
});

test("a member's page reads on a phone, axe clean at 320", async ({ page, baseURL }) => {
  await page.setViewportSize({ width: 320, height: 800 });
  await signedIn(page, baseURL);
  await open(page, ACHIENG);
  await expect(page.locator("h1")).toHaveCount(1);
  await noSidewaysScroll(page);
  await runAxe(page, test.info(), "member profile 320");
});

test("a handle nobody has, one held by a check, and one out of shape, are the same 404", async ({ page, baseURL }) => {
  await signedIn(page, baseURL);
  const answers: Array<Record<string, unknown>> = [];
  for (const path of [`${PATH}/nobody-by-this-name`, `${PATH}/ruth-chepkemoi`, `${PATH}/Achieng-Otieno`]) {
    const response = await page.request.get(path);
    const headers = response.headers();
    answers.push({ status: response.status(), body: await response.text(), cache: headers["cache-control"], vary: headers.vary, type: headers["content-type"] });
  }
  expect(answers[0]).toMatchObject({ status: 404, cache: "no-store" });
  for (const answer of answers.slice(1)) expect(answer).toEqual(answers[0]);
});

test("focus on a card shows on the whole card, and nothing moves under reduced motion", async ({ page, baseURL }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await signedIn(page, baseURL);
  await open(page, PATH);
  const first = cards(page).first();
  await first.locator(".member-card__link").focus();
  await expect(first).toHaveCSS("outline-style", "solid");
  await expect(first).toHaveCSS("outline-width", "2px");
  await expect(first).toHaveCSS("transition-duration", "0s");
});

test.describe("on a touch screen", () => {
  test.use({ hasTouch: true, isMobile: true, viewport: { width: 390, height: 844 } });

  const tallEnough = async (controls: Locator) => {
    expect(await controls.count()).toBeGreaterThan(0);
    for (const control of await controls.all()) {
      const box = await control.boundingBox();
      expect(box?.height ?? 0, await control.evaluate((element) => element.outerHTML.slice(0, 80))).toBeGreaterThanOrEqual(44);
    }
  };

  test("the search folds away on a phone, and every control in it and the pager is at least 44px tall", async ({ page, baseURL }) => {
    await signedIn(page, baseURL);
    await open(page, PATH);
    const search = main(page).getByRole("search", { name: "Find members" });
    await expect(search.getByLabel("Skills")).toBeHidden();
    await search.locator("summary").click();
    await expect(search.getByLabel("Skills")).toBeVisible();
    await tallEnough(main(page).locator(".member-search > summary, [data-member-filters] :is(input, select, button, a), [data-pager] a, [data-member-you] a"));
  });

  test("every link on a member's page is at least 44px tall", async ({ page, baseURL }) => {
    await signedIn(page, baseURL);
    await open(page, ACHIENG);
    await tallEnough(main(page).locator("[data-member-profile] a"));
  });
});

test("institutions see the same members, with a quiet way to Discover's tools", async ({ page, baseURL }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await signedIn(page, baseURL, "institution");
  await open(page, PATH);
  await expect(main(page).locator("[data-member-discover] a")).toHaveAttribute("href", "/dashboard/discover");
  await expect(cards(page).first()).toBeVisible();
  // An organisation's person is listed only through a saved profile of their own, like anyone.
  await expect(main(page).locator("[data-member-you]")).toHaveAttribute("data-member-you", "unlisted");
  await page.screenshot({ path: evidence("institution-1440"), fullPage: true });
});

test.describe("without JavaScript", () => {
  test.use({ javaScriptEnabled: false });

  test("the search narrows the list by address, says when it finds no one, and leads back to everyone", async ({ page, baseURL }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await signedIn(page, baseURL);
    await open(page, PATH, { script: false });
    const search = main(page).getByRole("search", { name: "Find members" });
    // Folded on a phone; a disclosure opens without JavaScript.
    await search.locator("summary").click();
    await search.getByLabel("Skills").fill("TypeScript");
    await search.getByRole("button", { name: "Show members" }).click();
    await expect(page).toHaveURL(/[?&]skills=TypeScript(&|#|$)/);
    await expect(main(page).locator("#member-results")).toHaveText(/^\d+ members? match(es)?$/);
    await expect(search.getByLabel("Skills")).toHaveValue("TypeScript");

    await search.getByLabel("Search").fill("zz-no-one-matches-this");
    await search.getByRole("button", { name: "Show members" }).click();
    await expect(main(page).locator("#member-results")).toHaveText("0 members match");
    await expect(main(page).locator("[data-empty-state]")).toContainText("No members match this search");
    await page.screenshot({ path: evidence("search-empty-390"), fullPage: true });
    await main(page).getByRole("link", { name: "Show everyone" }).click();
    await expect(page).toHaveURL(new RegExp(`${PATH}#member-results$`));
    await expect(main(page).locator("#member-results")).toHaveText(/^\d+ members?$/);
  });
});
