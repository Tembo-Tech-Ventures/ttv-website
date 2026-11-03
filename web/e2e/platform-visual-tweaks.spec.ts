import { expect, test, type Page } from "@playwright/test";
import { runAxe } from "./platform-axe";

/**
 * The prototype-vs-live visual tweaks whose behaviour a browser has to see (T03, T04, T06, T09, T10, T12;
 * Library /reports/platform-visual-review-2026-11-03/), on the DEV-only harnesses: a masked contact
 * marker in a mentor's request card, the directory's filter menus, the accepted request's notice, where a thread opens, where
 * "Jump to latest" stands, and the phone's bar on the attention page. Unit tests cover the markup.
 */
test.skip(Boolean(process.env.PLAYWRIGHT_BASE_URL), "The harnesses are dev-only and unavailable on deployed environments.");
test.use({ reducedMotion: "reduce" });

const MARKER = "[contact details hidden until a moderator checks this message]";
const NOTE = "Contact details hidden until a moderator checks this message";
const COMMUNITY_THREAD = "s00000000000000000000401";

const wide = (page: Page) => (page.viewportSize()?.width ?? 0) >= 1024;

async function open(page: Page, path: string) {
  await page.goto(path);
  await expect(page.locator("astro-island[ssr]")).toHaveCount(0);
  await page.evaluate(() => document.fonts.ready);
}

test("T03: a mentor's request card shows masked contact details as the channels' note, axe clean", async ({ page }, testInfo) => {
  await open(page, "/dev/platform-mentors?persona=david&view=requests&note=masked");
  const quote = page.locator("main [data-mentor-request] blockquote").first();
  await expect(quote.locator(".channel-masked[role=note]")).toHaveText(NOTE);
  await expect(quote).not.toContainText(MARKER);
  await runAxe(page, testInfo, "request-masked");
});

test("T06: both filter menus open inside the screen and the filter row, from 320 to 1440 px (B1)", async ({ page }) => {
  await open(page, "/dev/platform-mentors?persona=wanjiku&view=directory");
  for (const width of [320, 390, 768, 1024, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    for (const menu of await page.locator("[data-mentor-filters] details[data-filter-menu]").all()) {
      await menu.locator("summary").click();
      const list = menu.locator(".mentor-filter-menu__list");
      await expect(list).toBeVisible();
      const [box, row] = [await list.boundingBox(), await page.locator("[data-mentor-filters]").boundingBox()];
      expect(box!.x, `${width}px`).toBeGreaterThanOrEqual(Math.max(0, row!.x - 1));
      expect(box!.x + box!.width, `${width}px`).toBeLessThanOrEqual(Math.min(width, row!.x + row!.width + 1));
      await page.keyboard.press("Escape");
      await expect(list).toBeHidden();
    }
  }
});

test("T04: an accepted request leads with the mentor and shows Open conversation, on the panel and the page", async ({ page }, testInfo) => {
  const accepted = (scope: ReturnType<Page["locator"]>) => scope.locator("[data-attention-item]").filter({ has: page.locator("[data-attention-action]") });
  await open(page, "/dev/platform-overlays?persona=wanjiku&page=attention");
  const row = accepted(page.locator("main"));
  await expect(row).toHaveCount(1);
  await expect(row.locator("strong")).toHaveText("David Kamau");
  await expect(row.locator("[data-attention-action]")).toHaveText("Open conversation");
  await expect(row.locator("[data-attention-action]")).toBeVisible();
  // The row is one link, to the conversation; the action is its words, not a second control.
  await expect(row.locator("a")).toHaveCount(1);
  await expect(row.locator("a")).toHaveAttribute("href", /^\/dashboard\/community\/dm\//);
  await runAxe(page, testInfo, "attention-page");
  if (!wide(page)) return;
  await open(page, "/dev/platform-overlays?persona=wanjiku");
  await page.getByRole("button", { name: /Needs your attention|attention/i }).first().click();
  const panel = page.locator("[data-attention-panel]");
  await expect(accepted(panel).locator("[data-attention-action]")).toBeVisible();
  await runAxe(page, testInfo, "attention-panel");
});

test.describe("T09: where a thread opens", () => {
  test.use({ viewport: { width: 1440, height: 560 } });

  test("at its latest reply, and at a linked reply when a link names one", async ({ page }) => {
    await open(page, `/dev/platform-channel?persona=wanjiku&channel=show-your-work&thread=${COMMUNITY_THREAD}`);
    const rail = page.locator("[data-thread-rail] [data-focus-home]");
    const replies = page.locator("[data-thread-rail] .channel-messages [data-message]");
    await expect(replies.last()).toBeInViewport();
    expect(await rail.evaluate((el) => el.scrollHeight - el.scrollTop - el.clientHeight)).toBeLessThan(2);
    expect(await rail.evaluate((el) => el.scrollHeight > el.clientHeight + 40), "the thread is longer than its rail").toBe(true);

    const first = await replies.first().getAttribute("data-message");
    await open(page, `/dev/platform-channel?persona=wanjiku&channel=show-your-work&thread=${COMMUNITY_THREAD}&message=${first}`);
    await expect(replies.first()).toBeInViewport();
    await expect(replies.first()).toBeFocused();
  });
});

test("T10: Jump to latest stands on the list's bottom edge, at its end, compact on phones", async ({ page }) => {
  await open(page, "/dev/platform-channel?persona=wanjiku&channel=cohort-04");
  const scroller = page.locator("[data-channel-scroller]");
  await scroller.evaluate((el) => el.scrollTo({ top: 0 }));
  const jump = page.locator("[data-jump-latest]");
  await expect(jump).toBeVisible();
  const [button, list] = [await jump.boundingBox(), await scroller.boundingBox()];
  // Across the list's bottom edge, at its right end, not over the middle of the messages.
  expect(button!.y).toBeLessThan(list!.y + list!.height);
  expect(button!.y + button!.height).toBeGreaterThan(list!.y + list!.height);
  expect(button!.x + button!.width).toBeGreaterThan(list!.x + list!.width * 0.75);
  await expect(jump).toHaveAccessibleName("Jump to latest");
  if (!wide(page)) expect(Math.round(button!.width)).toBe(44);
});

test("T12: the phone's bar marks no space current on the attention page", async ({ page }) => {
  await open(page, "/dev/platform-overlays?persona=wanjiku&page=attention");
  test.skip(wide(page), "The bottom bar is the phone's.");
  const bar = page.getByRole("navigation", { name: "Spaces" });
  await expect(bar.getByRole("link")).not.toHaveCount(0);
  await expect(bar.locator("[aria-current]")).toHaveCount(0);
});
