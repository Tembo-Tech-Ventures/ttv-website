import { mkdirSync } from "node:fs";
import { expect, test, type Page } from "@playwright/test";
import { runAxe } from "./platform-axe";
import { personaSession, signIn } from "./platform-personas";

/**
 * Community's home on the kit (style-guide rollout M15): the kit title "Community" and a sentence,
 * onboarding's cards after it, the profile in a kit card with an avatar, "Who can discover this?" as
 * an info notice, and "Add a contribution" as the one peach action. There is no island: the editors
 * open from links and save through plain forms, so a member adds a contribution and edits their
 * profile without JavaScript. Writes run against the local seed only, so a preview's persona keeps
 * its journey. Render-level detail is in src/pages/dashboard/community/_tests/home.render.test.ts.
 */
const EVIDENCE_DIR = "test-results/evidence/platform-community-home";
mkdirSync(EVIDENCE_DIR, { recursive: true });
const PREVIEW = Boolean(process.env.PLAYWRIGHT_BASE_URL);
const PATH = "/dashboard/community";

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
    await expect(primaries(page)).toHaveText("Add a contribution");
    const profile = main(page).locator("[data-community-profile]");
    await expect(profile.locator("[data-avatar]")).toBeVisible();
    await expect(profile.getByRole("link", { name: "Edit your profile" })).toBeVisible();
    await expect(main(page).locator("[data-notice='info']", { hasText: "Who can discover this?" })).toBeVisible();
    await noSidewaysScroll(page);
    await page.screenshot({ path: evidence(`home-${width}`), fullPage: true });
    await runAxe(page, test.info(), `community home ${width}`);
  });
}

test.describe("without JavaScript", () => {
  test.use({ javaScriptEnabled: false });

  test("a contribution with problems comes back with what was written; a good one saves and says so once", async ({ page, baseURL }) => {
    test.skip(PREVIEW, "Writes run against the local seed only.");
    await page.setViewportSize({ width: 390, height: 844 });
    await signedIn(page, baseURL);
    await open(page, PATH, { script: false });
    await main(page).getByRole("link", { name: "Add a contribution" }).click();
    await expect(page).toHaveURL(/\?add=1#contribution-editor$/);
    const editor = main(page).locator("[data-contribution-editor='add']");
    await expect(primaries(page)).toHaveText("Save contribution");

    // The browser's own checks let this through; the page's do not.
    await editor.getByLabel("Entry title").fill("Bus fare splitter");
    await editor.getByLabel("Your contribution").fill("Wrote the fare-splitting logic and its tests.");
    await editor.getByLabel("Date").fill("2026-10-30");
    await editor.getByLabel(/Source link/).fill("https://example.test/dashboard/private");
    await editor.getByRole("button", { name: "Save contribution" }).click();
    await expect(page).toHaveTitle(/^Error: /);
    const refused = main(page).locator("[data-contribution-editor='add']");
    await expect(refused.locator("[data-notice='danger']")).toBeFocused();
    await expect(refused.getByLabel("Entry title")).toHaveValue("Bus fare splitter");
    await page.screenshot({ path: evidence("refused-no-js") });

    const title = `Bus fare splitter ${Date.now()}`;
    await refused.getByLabel("Entry title").fill(title);
    await refused.getByLabel(/Source link/).fill("https://github.com/example/fares");
    await refused.getByRole("button", { name: "Save contribution" }).click();
    await expect(page).toHaveURL((url) => url.pathname === PATH && url.search === "");
    await expect(main(page).locator("[data-notice='success']")).toContainText("Your contribution has been saved.");
    await expect(main(page).getByRole("heading", { level: 3, name: title })).toBeVisible();
    await page.reload();
    await expect(main(page).locator("[data-notice='success']")).toHaveCount(0);
  });

  test("the profile editor opens in place, and a refusal keeps what was typed", async ({ page, baseURL }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await signedIn(page, baseURL);
    await open(page, PATH, { script: false });
    await main(page).getByRole("link", { name: "Edit your profile" }).click();
    const editor = main(page).locator("[data-profile-editor]");
    await expect(editor).toBeVisible();
    await expect(main(page).locator("[data-community-profile]")).toHaveCount(0);
    const skills = Array.from({ length: 31 }, (_, index) => `skill ${index}`).join(", ");
    await editor.getByLabel(/^Skills/).fill(skills);
    await editor.getByRole("button", { name: "Save profile" }).click();
    await expect(page).toHaveTitle(/^Error: /);
    await expect(main(page).locator("[data-profile-editor]").getByLabel(/^Skills/)).toHaveValue(skills);
    await expect(main(page).locator("[data-profile-editor]")).toContainText("Add no more than 30 skills.");
    await main(page).locator("[data-profile-editor]").getByRole("link", { name: "Cancel" }).click();
    await expect(main(page).locator("[data-community-profile]")).toBeVisible();
  });
});
