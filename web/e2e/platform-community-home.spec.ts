import { mkdirSync } from "node:fs";
import { expect, test, type Page } from "@playwright/test";
import { runAxe } from "./platform-axe";
import { personaSession, signIn } from "./platform-personas";

/**
 * Community's home: the kit title "Community" and a sentence, onboarding's cards after it, the profile
 * in a kit card with an avatar, "Who sees this" as an info notice, and "Post work" as the one peach
 * action. It edits nothing itself: "Post work" and "Edit your profile" lead to the one profile editor
 * in the Profile space, where a member posts work without JavaScript and comes back to see it here.
 * Writes run against the local seed only, so a preview's persona keeps its journey. Render-level
 * detail is in src/pages/dashboard/community/_tests/home.render.test.ts and portfolio.render.test.ts.
 */
const EVIDENCE_DIR = "test-results/evidence/platform-community-home";
mkdirSync(EVIDENCE_DIR, { recursive: true });
const PREVIEW = Boolean(process.env.PLAYWRIGHT_BASE_URL);
const PATH = "/dashboard/community";
const EDITOR = "/dashboard/me/portfolio";

const main = (page: Page) => page.locator("#spaces-main");
const evidence = (name: string) => `${EVIDENCE_DIR}/${test.info().project.name}-${name}.png`;

test.use({ reducedMotion: "reduce" });

async function signedIn(page: Page, baseURL: string | undefined) {
  const session = personaSession("community");
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

const primaries = (page: Page) => main(page).locator("[data-variant='primary']");

for (const width of [1440, 320]) {
  test(`reads as the style guide at ${width}px: one title, one peach action, kit card and notice`, async ({ page, baseURL }) => {
    await page.setViewportSize({ width, height: 900 });
    await signedIn(page, baseURL);
    await open(page, PATH);
    await expect(main(page).getByRole("heading", { level: 1 })).toHaveText("Community");
    await expect(primaries(page)).toHaveCount(1);
    await expect(primaries(page)).toHaveText("Post work");
    const profile = main(page).locator("[data-community-profile]");
    await expect(profile.locator("[data-avatar]")).toBeVisible();
    await expect(profile.getByRole("link", { name: "Edit your profile" })).toHaveAttribute("href", `${EDITOR}#profile-form`);
    await expect(main(page).locator("[data-notice='info']", { hasText: "Who sees this" }))
      .toContainText("Everyone signed in to TTV can see your profile and everything you post.");
    await noSidewaysScroll(page);
    await page.screenshot({ path: evidence(`home-${width}`), fullPage: true });
    await runAxe(page, test.info(), `community home ${width}`);
  });
}

test.describe("without JavaScript", () => {
  test.use({ javaScriptEnabled: false });

  test("Post work leads to the editor; a piece with problems comes back with what was written; a good one is posted and shows at home", async ({ page, baseURL }) => {
    test.skip(PREVIEW, "Writes run against the local seed only.");
    await page.setViewportSize({ width: 390, height: 844 });
    await signedIn(page, baseURL);
    await open(page, PATH, { script: false });
    await main(page).getByRole("link", { name: "Post work" }).click();
    await expect(page).toHaveURL(new RegExp(`${EDITOR}\\?add=1#work-editor$`));
    const editor = main(page).locator("[data-work-editor='add']");
    // Who sees it, said in the choice to post it (the page says the rest at its top).
    await expect(editor).toContainText("Everyone signed in to TTV can see it, and mentors can confirm it.");

    // The browser's own checks let this through; the page's do not.
    await editor.getByLabel("Title").fill("Bus fare splitter");
    await editor.getByLabel("What you did").fill("Wrote the fare-splitting logic and its tests.");
    await editor.getByLabel("When").fill("2026-10-30");
    await editor.getByLabel(/^Link/).fill("https://example.test/dashboard/private");
    await editor.getByRole("button", { name: "Save" }).click();
    await expect(page).toHaveTitle(/^Error: /);
    const refused = main(page).locator("[data-work-editor='add']");
    await expect(refused.locator("[data-notice='danger']")).toBeFocused();
    await expect(refused.getByLabel("Title")).toHaveValue("Bus fare splitter");
    await page.screenshot({ path: evidence("refused-no-js") });

    const title = `Bus fare splitter ${Date.now()}`;
    await refused.getByLabel("Title").fill(title);
    await refused.getByLabel(/^Link/).fill("https://github.com/example/fares");
    await refused.getByRole("button", { name: "Save" }).click();
    await expect(page).toHaveURL((url) => url.pathname === EDITOR && url.search === "");
    await expect(main(page).locator("[data-notice='success']")).toContainText("Posted");
    await expect(main(page).getByRole("heading", { level: 3, name: title })).toBeVisible();
    await page.reload();
    await expect(main(page).locator("[data-notice='success']")).toHaveCount(0);
    await open(page, PATH, { script: false });
    await expect(main(page).getByRole("heading", { level: 3, name: title })).toBeVisible();
  });

  test("Edit your profile leads to the editor's profile form, and a refusal keeps what was typed", async ({ page, baseURL }) => {
    test.skip(PREVIEW, "Writes run against the local seed only.");
    await page.setViewportSize({ width: 390, height: 844 });
    await signedIn(page, baseURL);
    await open(page, PATH, { script: false });
    await main(page).getByRole("link", { name: "Edit your profile" }).click();
    await expect(page).toHaveURL(new RegExp(`${EDITOR}#profile-form$`));
    const form = main(page).locator("[data-profile-form] form");
    const tooLong = "A skill name well over thirty characters long";
    // Lucy has a saved profile, so her handle stays put unless she asks to change it.
    await expect(form.getByLabel(/^Handle/)).toHaveCount(0);
    await form.getByLabel(/^Skills/).fill(tooLong);
    await form.evaluate((element: HTMLFormElement) => element.submit());
    await expect(page).toHaveTitle(/^Error: /);
    await expect(main(page).locator("[data-profile-form]").getByLabel(/^Skills/)).toHaveValue(tooLong);
  });
});
