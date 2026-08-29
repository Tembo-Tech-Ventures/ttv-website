import { expect, test, type Page, type TestInfo } from "@playwright/test";

/**
 * Layout regression + screenshot capture for the full-page chat prototypes.
 *
 * The prototypes live at dev-only routes, so this suite only runs against a
 * local `npm run dev`; against a deployed base URL the routes 404 by design.
 *
 * The assertions encode the whole point of the redesign: on a phone the page
 * itself must not scroll, exactly one region inside it may, and the composer
 * must be on screen without the user hunting for it.
 */
const isLocalDev = !process.env.PLAYWRIGHT_BASE_URL;

test.skip(!isLocalDev, "Prototype routes are dev-only");

const VARIANTS = [
  { slug: "a", name: "takeover-bar" },
  { slug: "b", name: "icon-rail" },
  { slug: "c", name: "bottom-sheet" },
] as const;

/** Elements that actually scroll right now (visible, overflowing, scrollable). */
async function countScrollableRegions(page: Page) {
  return page.evaluate(() =>
    Array.from(document.querySelectorAll<HTMLElement>("body *")).filter((element) => {
      const style = getComputedStyle(element);
      const scrolls = style.overflowY === "auto" || style.overflowY === "scroll";
      return scrolls && element.scrollHeight > element.clientHeight + 1;
    }).length
  );
}

async function pageScrollOverflow(page: Page) {
  return page.evaluate(() => {
    const root = document.scrollingElement ?? document.documentElement;
    return root.scrollHeight - root.clientHeight;
  });
}

const EVIDENCE_DIR = "test-results/evidence/chat-proto";

async function shoot(page: Page, testInfo: TestInfo, name: string) {
  const path = `${EVIDENCE_DIR}/${testInfo.project.name}-${name}.png`;
  await page.screenshot({ path });
  await testInfo.attach(name, { path, contentType: "image/png" });
}

for (const variant of VARIANTS) {
  test(`prototype ${variant.slug} (${variant.name}) keeps a single scroll surface`, async ({
    page,
  }, testInfo) => {
    await page.goto(`/dev/chat-proto/${variant.slug}`);
    await expect(page.getByRole("button", { name: "Send message" })).toBeVisible();

    // The document must not scroll — the transcript owns all the overflow.
    expect(await pageScrollOverflow(page)).toBeLessThanOrEqual(1);

    // The composer is reachable without any scrolling at all.
    await expect(page.getByPlaceholder("Ask about your sessions…")).toBeInViewport();

    const scrollables = await countScrollableRegions(page);
    const isMobile = testInfo.project.name.includes("mobile");
    // Phone: the transcript, and nothing else. Desktop may additionally scroll
    // the conversation rail, which is a separate column rather than a nested one.
    expect(scrollables).toBeLessThanOrEqual(isMobile ? 1 : 2);

    await shoot(page, testInfo, `${variant.slug}-${variant.name}`);
  });

  test(`prototype ${variant.slug} (${variant.name}) opens conversation switching on mobile`, async ({
    page,
  }, testInfo) => {
    test.skip(!testInfo.project.name.includes("mobile"), "Drawer/sheet is a mobile affordance");

    await page.goto(`/dev/chat-proto/${variant.slug}`);
    const trigger = page
      .getByRole("button", { name: /Open conversations|Switch conversation/ })
      .first();
    await trigger.click();

    const dialog = page.getByRole("dialog");
    await expect(dialog).toBeVisible();
    await expect(dialog.getByRole("button", { name: /Customer discovery next steps/ })).toBeVisible();

    await shoot(page, testInfo, `${variant.slug}-${variant.name}-drawer`);

    await page.keyboard.press("Escape");
    await expect(dialog).toBeHidden();
  });
}

test("empty state offers capability-led prompts as buttons", async ({ page }, testInfo) => {
  await page.goto("/dev/chat-proto/a");
  await page.getByRole("button", { name: "New chat" }).first().click();

  await expect(page.getByRole("heading", { name: "Ask across your sessions" })).toBeVisible();
  const suggestion = page.getByRole("button", { name: /main action items/ });
  await expect(suggestion).toBeVisible();

  await shoot(page, testInfo, "a-empty-state");

  // A suggestion is a real send, not decoration.
  await suggestion.click();
  await expect(page.getByText("What were the main action items from mentor hours?")).toBeVisible();
});

test("scrolling up reveals jump-to-latest without moving the page", async ({ page }, testInfo) => {
  await page.goto("/dev/chat-proto/a");
  const scroller = page.locator("[data-chat-scroller]");
  // Wait for the mount-time pin to the newest message, otherwise scrolling to
  // the top races it and lands back at the bottom with no jump button.
  await expect
    .poll(() => scroller.evaluate((element) => element.scrollTop))
    .toBeGreaterThan(0);
  await scroller.evaluate((element) => element.scrollTo({ top: 0 }));

  await expect(page.getByRole("button", { name: "Jump to latest" })).toBeVisible();
  expect(await pageScrollOverflow(page)).toBeLessThanOrEqual(1);
  await shoot(page, testInfo, "a-jump-to-latest");

  await page.getByRole("button", { name: "Jump to latest" }).click();
  await expect(page.getByRole("button", { name: "Jump to latest" })).toBeHidden();
});

test("current chat page for comparison", async ({ page }, testInfo) => {
  await page.goto("/dev/chat-ui");
  await expect(page.getByPlaceholder(/Ask a question/)).toBeAttached();
  await shoot(page, testInfo, "before-current");
});
