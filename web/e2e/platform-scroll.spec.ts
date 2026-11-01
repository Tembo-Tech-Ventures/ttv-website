import { expect, test, type Page } from "@playwright/test";

/**
 * The browser check for the channel scroll-anchoring hooks (S-2.3), on the
 * DEV-only harness `/dev/platform-scroll`. jsdom-style unit tests cover the
 * logic with a layout model; this proves it against real layout: uneven
 * message heights, a real scroll container and real resize events.
 */
const HARNESS = "/dev/platform-scroll";

test.describe("on a deployed build", () => {
  test.skip(!process.env.PLAYWRIGHT_BASE_URL, "Only deployed builds prove the harness is absent.");

  test("the scroll harness does not exist", async ({ page }) => {
    const response = await page.goto(HARNESS);
    expect(response?.status()).toBe(404);
  });
});

test.describe("scroll anchoring", () => {
  test.skip(Boolean(process.env.PLAYWRIGHT_BASE_URL), "The harness is dev-only and intentionally unavailable on deployed environments.");

  const scroller = (page: Page) => page.locator("[data-scroller]");
  const harness = (page: Page) => page.locator("[data-scroll-harness]");
  const distanceFromBottom = (page: Page) =>
    scroller(page).evaluate(element => element.scrollHeight - element.scrollTop - element.clientHeight);
  const top = async (page: Page, id: string) => (await page.locator(`[data-message-row="${id}"]`).boundingBox())!.y;

  test.beforeEach(async ({ page }) => {
    await page.goto(HARNESS);
    await expect(page.locator("astro-island[ssr]")).toHaveCount(0);
    await page.addStyleTag({ content: "astro-dev-toolbar { display: none !important; }" });
  });

  test("keeps the reader's place when older messages load, and follows the newest only from the bottom", async ({ page }) => {
    // Opens at the newest message.
    await expect(harness(page)).toHaveAttribute("data-at-bottom", "true");
    expect(await distanceFromBottom(page)).toBeLessThanOrEqual(1);

    // At the bottom, a new message and a growing embed keep the reader there.
    await page.getByRole("button", { name: "Someone posts" }).click();
    await expect.poll(() => distanceFromBottom(page)).toBeLessThanOrEqual(1);
    await page.getByRole("button", { name: "Embed loads" }).click();
    await expect(page.locator("[data-embed]")).toBeVisible();
    await expect.poll(() => distanceFromBottom(page)).toBeLessThanOrEqual(1);

    // Reading older history: the message in view doesn't move when 20 older ones load above it.
    await scroller(page).evaluate(element => { element.scrollTop = 0; });
    await expect(harness(page)).toHaveAttribute("data-at-bottom", "false");
    await expect(harness(page)).toHaveAttribute("data-anchor", "msg-61");
    const before = await top(page, "msg-61");
    await page.getByRole("button", { name: "Load older" }).click();
    await expect(page.locator('[data-message-row="msg-41"]')).toHaveCount(1);
    expect(Math.abs(await top(page, "msg-61") - before)).toBeLessThanOrEqual(1);
    await expect(harness(page)).toHaveAttribute("data-anchor", "msg-61");

    // Someone else posting doesn't pull the reader down; their own message does.
    await page.getByRole("button", { name: "Someone posts" }).click();
    await expect(page.locator('[data-message-row="msg-102"]')).toHaveCount(1);
    expect(Math.abs(await top(page, "msg-61") - before)).toBeLessThanOrEqual(1);
    await page.getByRole("button", { name: "I post" }).click();
    await expect.poll(() => distanceFromBottom(page)).toBeLessThanOrEqual(1);

    // A thread takes the list's place (phone): hidden, the list reports nothing; shown, the reader is where they were.
    await scroller(page).evaluate(element => { element.scrollTop = 0; });
    await expect(harness(page)).toHaveAttribute("data-anchor", "msg-41");
    const reading = await top(page, "msg-41");
    await page.getByRole("button", { name: "Open thread" }).click();
    await expect(scroller(page)).toBeHidden();
    await page.getByRole("button", { name: "Someone posts" }).click();
    await expect(harness(page)).toHaveAttribute("data-at-bottom", "false");
    await expect(harness(page)).toHaveAttribute("data-anchor", "msg-41");
    await page.getByRole("button", { name: "Back to channel" }).click();
    await expect(scroller(page)).toBeVisible();
    await expect.poll(async () => Math.abs(await top(page, "msg-41") - reading)).toBeLessThanOrEqual(1);
    await expect(harness(page)).toHaveAttribute("data-at-bottom", "false");

    // A scroll whose event hasn't arrived yet survives older messages rendering in the same frame.
    await page.locator("[data-scroller]").evaluate(element => { element.scrollTop = 600; });
    await expect(harness(page)).not.toHaveAttribute("data-anchor", "msg-41");
    const anchored = (await harness(page).getAttribute("data-anchor"))!;
    const settled = await top(page, anchored);
    await page.evaluate(() => {
      const element = document.querySelector<HTMLElement>("[data-scroller]")!;
      element.scrollTop -= 120;
      [...document.querySelectorAll("button")].find(button => button.textContent === "Load older")!.click();
    });
    await expect(page.locator('[data-message-row="msg-21"]')).toHaveCount(1);
    await expect.poll(async () => Math.abs(await top(page, anchored) - (settled + 120))).toBeLessThanOrEqual(1);

    // Jump to latest from anywhere.
    await scroller(page).evaluate(element => { element.scrollTop = 0; });
    await page.getByRole("button", { name: "Jump to latest" }).click();
    await expect(harness(page)).toHaveAttribute("data-at-bottom", "true");
    expect(await distanceFromBottom(page)).toBeLessThanOrEqual(1);
  });
});
