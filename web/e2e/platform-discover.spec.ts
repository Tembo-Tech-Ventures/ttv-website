import { mkdirSync } from "node:fs";
import { expect, test, type Page } from "@playwright/test";
import { runAxe } from "./platform-axe";
import { personaSession, signIn } from "./platform-personas";

/**
 * Discover on the kit (style-guide rollout M16): the kit title and a sentence, the two ways in as a
 * PillNav, kit fields and cards, one peach action per view, and no island. An institution looks a
 * member up by name, opens their work and asks Tembo about it without JavaScript. Locally there is
 * no AI binding, so Tembo's answer fails and the page keeps the question; a preview answers.
 * Render-level detail is in src/pages/dashboard/_tests/discover.render.test.ts.
 */
const EVIDENCE_DIR = "test-results/evidence/platform-discover";
mkdirSync(EVIDENCE_DIR, { recursive: true });
const PREVIEW = Boolean(process.env.PLAYWRIGHT_BASE_URL);
const PATH = "/dashboard/discover";
// Lookup lists saved community profiles only: locally the seeded alumna, on a preview the staging
// persona otherMember (Fictional Brian Otieno), the one persona with a saved profile.
const MEMBER = PREVIEW ? "Brian" : "Achieng";

const main = (page: Page) => page.locator("#spaces-main");
const evidence = (name: string) => `${EVIDENCE_DIR}/${test.info().project.name}-${name}.png`;
const primaries = (page: Page) => main(page).locator("[data-variant='primary']");

test.use({ reducedMotion: "reduce" });

async function signedIn(page: Page, baseURL: string | undefined) {
  const session = personaSession("institution");
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

for (const width of [1440, 320]) {
  test(`reads as the style guide at ${width}px: one title, two ways in, one peach action`, async ({ page, baseURL }) => {
    await page.setViewportSize({ width, height: 900 });
    await signedIn(page, baseURL);
    await open(page, PATH);
    await expect(main(page).getByRole("heading", { level: 1 })).toHaveText("Discover");
    await expect(main(page).getByRole("navigation", { name: "How to discover people" }).getByRole("link", { name: "Scout by criteria" }))
      .toHaveAttribute("aria-current", "page");
    await expect(primaries(page)).toHaveText(["Discover people"]);
    await expect(main(page).locator("astro-island")).toHaveCount(0);
    expect(await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)).toBeLessThanOrEqual(0);
    await page.screenshot({ path: evidence(`criteria-${width}`) });
    await runAxe(page, test.info(), `discover ${width}`);
  });
}

test.describe("without JavaScript", () => {
  test.use({ javaScriptEnabled: false });

  test("an institution looks a member up, opens their work and asks Tembo about it", async ({ page, baseURL }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await signedIn(page, baseURL);
    await open(page, PATH, { script: false });
    await main(page).getByRole("link", { name: "Find someone you know" }).click();
    await main(page).getByLabel("Name to look up").fill(MEMBER);
    await main(page).getByRole("button", { name: "Look up person" }).click();
    await expect(page).toHaveURL(new RegExp(`lookup=1&scout=results&query=${MEMBER}`));
    const person = main(page).locator("[data-person]").filter({ hasText: MEMBER }).first();
    await expect(person).toBeVisible();
    await page.screenshot({ path: evidence("lookup-results") });

    await person.getByRole("link", { name: /^Explore .+'s work$/ }).click();
    await expect(main(page).getByRole("heading", { level: 2, name: "The work behind the profile" })).toBeVisible();
    await expect(primaries(page)).toHaveText(["Explore evidence"]);
    await page.screenshot({ path: evidence("profile") });

    await main(page).getByLabel("Your question").fill("What did they build?");
    await main(page).getByRole("button", { name: "Explore evidence" }).click();
    const ask = main(page).locator("[data-discover-ask]");
    if (PREVIEW) {
      await expect(main(page).locator("[data-discover-answer]")).toBeVisible({ timeout: 70_000 });
    } else {
      // No AI binding locally: the failure is said, and the question kept.
      await expect(ask.locator("[data-notice='danger']")).toBeFocused();
      await expect(ask.getByLabel("Your question")).toHaveValue("What did they build?");
    }

    await main(page).getByRole("link", { name: "Back to people" }).click();
    await expect(main(page).locator("[data-person]").first()).toBeVisible();
  });

  test("a scouting search with nothing to search by comes back with an error under the field", async ({ page, baseURL }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await signedIn(page, baseURL);
    await open(page, PATH, { script: false });
    await main(page).getByRole("button", { name: "Discover people" }).click();
    await expect(page).toHaveTitle(/^Error: /);
    await expect(main(page).locator("[data-notice='danger']")).toBeFocused();
    await expect(main(page).getByLabel("What are you working on?")).toHaveAttribute("aria-invalid", "true");
    // The opportunity was posted: it is in no address.
    expect(new URL(page.url()).search).toBe("");
  });
});
