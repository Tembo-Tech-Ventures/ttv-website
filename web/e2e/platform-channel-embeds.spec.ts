import { expect, test, type Page } from "@playwright/test";
import { runAxe } from "./platform-axe";

/**
 * Shared work in channels (U-2.2) on the DEV-only gallery `/dev/platform-embeds`:
 * every state of the project and session clip cards, including work the
 * reader can no longer open, on the community and cohort sheets. The same
 * cards render inside messages on `/dev/platform-channel`.
 */
const GALLERY = "/dev/platform-embeds";
const EVIDENCE_DIR = "test-results/evidence/platform-channel-embeds";
const SWEEP = [320, 360, 390, 414, 600, 768, 1024, 1280, 1440];

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

async function open(page: Page) {
  await routeFonts(page);
  await page.goto(GALLERY);
  await page.evaluate(() => document.fonts.ready);
}

const scene = (page: Page, key: string) => page.locator(`[data-scene="${key}"]`).first();

test.beforeEach(({ browserName }, testInfo) => {
  test.skip(!process.env.PLAYWRIGHT_BASE_URL && testInfo.project.name !== "chromium", `covered by the chromium project (${browserName})`);
});

test.describe("on a deployed build", () => {
  test.skip(!process.env.PLAYWRIGHT_BASE_URL, "Only deployed builds prove the gallery is absent.");

  test("the embed gallery does not exist", async ({ page }) => {
    expect((await page.goto(GALLERY))?.status()).toBe(404);
  });
});

test.describe("shared work", () => {
  test.skip(Boolean(process.env.PLAYWRIGHT_BASE_URL), "The gallery exists only in astro dev.");

  for (const viewport of [{ width: 1440, height: 900 }, { width: 390, height: 844 }]) {
    test(`every card state at ${viewport.width}px: axe and containment`, async ({ page }, testInfo) => {
      await page.setViewportSize(viewport);
      await open(page);
      await page.screenshot({ path: `${EVIDENCE_DIR}/gallery-${viewport.width}.png`, fullPage: true });
      await runAxe(page, testInfo, `embeds-${viewport.width}`);

      // Every part of a card stays inside it: titles wrap, chips and links never spill over the edge.
      const spills = await page.evaluate(() =>
        [...document.querySelectorAll<HTMLElement>(".channel-embed")].flatMap((card) => {
          const box = card.getBoundingClientRect();
          return [...card.querySelectorAll<HTMLElement>("*")]
            .filter((child) => {
              const inner = child.getBoundingClientRect();
              return inner.width > 0 && (inner.left < box.left - 0.5 || inner.right > box.right + 0.5);
            })
            .map((child) => `${card.closest("[data-scene]")?.getAttribute("data-scene")}: ${child.className || child.tagName}`);
        }));
      expect(spills).toEqual([]);
    });
  }

  test("no sideways scrolling from 320 to 1440 px", async ({ page }) => {
    await open(page);
    for (const width of SWEEP) {
      await page.setViewportSize({ width, height: 900 });
      await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth), { message: `${width}px` }).toBe(0);
    }
  });

  test("on a phone the clip's moment sits clear of its play button, and its quote still says which moment", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await open(page);
    const clip = scene(page, "clip");
    const gap = async () => {
      const [play, at] = [await clip.locator(".channel-clip__play").boundingBox(), await clip.locator(".channel-clip__at").boundingBox()];
      return play && at ? Math.round(at.y - (play.y + play.height)) : null;
    };
    await expect.poll(gap).toBeGreaterThanOrEqual(4);
    await expect(clip.locator(".channel-clip__quote")).toBeVisible();
    await clip.screenshot({ path: `${EVIDENCE_DIR}/clip-390.png` });
  });

  test("a confirmation names its revision, and work that is gone says only that", async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await open(page);
    await expect(scene(page, "earlier-revision")).toContainText("Confirmed by David on revision 2");
    await expect(scene(page, "this-revision")).toContainText("Confirmed by Mercy on this revision");
    await expect(scene(page, "unconfirmed").locator("[aria-label='Mentor confirmations']")).toHaveCount(0);
    // B-2.4 sends no skills for a project, so a card shows none: only who confirmed which revision.
    await expect(scene(page, "several-mentors").getByRole("listitem")).toHaveText(["Confirmed by Mercy on this revision", "Confirmed by David on revision 2"]);
    // The project's own evidence link opens in a new tab and says so; without one there is no way in.
    const evidence = scene(page, "earlier-revision").getByRole("link", { name: /^Open Chama ledger/ });
    await expect(evidence).toHaveAttribute("target", "_blank");
    await expect(evidence).toHaveAttribute("rel", "noopener noreferrer");
    await expect(evidence).toHaveAccessibleName("Open Chama ledger: M-Pesa receipt parser (opens in a new tab)");
    await expect(scene(page, "no-link").getByRole("link")).toHaveCount(0);
    const gone = scene(page, "gone-project");
    await expect(gone).toContainText("This project is no longer available");
    await expect(gone.getByRole("link")).toHaveCount(0);
    await expect(scene(page, "gone-clip")).toContainText("This session clip is no longer available");
  });
});
