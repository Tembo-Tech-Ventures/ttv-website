import { expect, test, type Page, type TestInfo } from "@playwright/test";
import { MOCK_LATENCY_MS } from "../src/components/chat/mock-timing";

/** Widened per-request so tests can act inside the in-flight window. */
const SLOW_LOAD_MS = 1_500;

/**
 * Layout and interaction guarantees for the Ask AI page.
 *
 * These run against `/dev/chat-ui`, which renders the real `ChatApp` in the
 * real `ChatLayout` with fixed data — the authenticated `/dashboard/ask` route
 * is not reachable from a local dev server, and the point of these assertions
 * is the layout, which is identical.
 *
 * The assertions are the design contract, not decoration: the page itself must
 * never scroll, the composer must always be on screen, and only the transcript
 * may scroll on a phone. Every one of those was broken before this layout.
 */
test.skip(
  Boolean(process.env.PLAYWRIGHT_BASE_URL),
  "The mock chat page is dev-only and intentionally unavailable on deployed environments."
);

const EVIDENCE_DIR = "test-results/evidence/chat";

async function shoot(page: Page, testInfo: TestInfo, name: string) {
  const path = `${EVIDENCE_DIR}/${testInfo.project.name}-${name}.png`;
  await page.screenshot({ path });
  await testInfo.attach(name, { path, contentType: "image/png" });
}

/** Elements that are actually scrolling: visible, overflowing, and scrollable. */
async function countScrollableRegions(page: Page) {
  return page.evaluate(
    () =>
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

function isMobile(testInfo: TestInfo) {
  return testInfo.project.name.includes("mobile");
}

/**
 * Navigate and wait for the React island to hydrate.
 *
 * Astro serves the chat markup server-rendered and hydrates it afterwards.
 * Typing into a controlled textarea before then only mutates the DOM, so React
 * never sees the value and the send button stays disabled — a race that only
 * shows up when the dev server is busy. Astro drops the `ssr` attribute from
 * `<astro-island>` once the component is live, so that is the signal to wait on.
 */
async function gotoChat(page: Page, search = "") {
  await page.goto(`/dev/chat-ui${search}`);
  await expect(page.locator("astro-island")).not.toHaveAttribute("ssr", /.*/);
}

/**
 * Scope text assertions to the visible transcript. The offscreen live region
 * also contains the latest answer, so an unscoped `getByText` matches twice.
 */
function transcript(page: Page) {
  return page.locator("[data-chat-scroller]");
}

test("the page does not scroll and the composer is always on screen", async ({
  page,
}, testInfo) => {
  await gotoChat(page);
  await expect(page.getByRole("button", { name: "Send message" })).toBeVisible();

  expect(await pageScrollOverflow(page)).toBeLessThanOrEqual(1);
  await expect(page.getByPlaceholder("Ask about your sessions…")).toBeInViewport();

  // Phone: the transcript, and nothing else. Desktop may additionally scroll
  // the conversation rail, which is a separate column rather than a nested one.
  expect(await countScrollableRegions(page)).toBeLessThanOrEqual(isMobile(testInfo) ? 1 : 2);

  await shoot(page, testInfo, "ask-page");
});

test("renders markdown answers and timestamped source links", async ({ page }) => {
  await gotoChat(page);

  await expect(
    page.locator("li").filter({ hasText: "Run short customer interviews." })
  ).toBeVisible();

  const firstSource = page.getByRole("link", {
    name: /Source 1 6:24 Mentor Hours: Customer Discovery/,
  });
  await expect(firstSource).toHaveAttribute("href", "/dashboard/sessions/recording-1?t=384");
});

test("sends a message and keeps the layout intact afterwards", async ({ page }, testInfo) => {
  await gotoChat(page);

  await page.getByPlaceholder("Ask about your sessions…").fill("Summarise the MVP advice");
  await page.getByRole("button", { name: "Send message" }).click();

  await expect(transcript(page).getByText("validate the problem with users")).toBeVisible();
  expect(await pageScrollOverflow(page)).toBeLessThanOrEqual(1);
  await expect(page.getByPlaceholder("Ask about your sessions…")).toBeInViewport();
  expect(await countScrollableRegions(page)).toBeLessThanOrEqual(isMobile(testInfo) ? 1 : 2);
});

/** Desktop lists conversations in the rail; mobile needs the sheet opened. */
async function openConversationList(page: Page) {
  const sheetTrigger = page.locator("h1 button");
  if (await sheetTrigger.isVisible()) {
    await sheetTrigger.click();
    await expect(page.getByRole("dialog")).toBeVisible();
  }
}

/** The rail button on desktop, the header's plus button on mobile. */
function newChatControl(page: Page, testInfo: TestInfo) {
  return isMobile(testInfo)
    ? page.getByRole("button", { name: "Start a new chat" })
    : page.getByRole("button", { name: "New chat" });
}

test("a new chat shows suggested prompts that send on click", async ({ page }, testInfo) => {
  await gotoChat(page);
  await newChatControl(page, testInfo).click();

  await expect(page.getByRole("heading", { name: "Ask across your sessions" })).toBeVisible();
  await shoot(page, testInfo, "empty-state");

  await page.getByRole("button", { name: /main action items/ }).click();
  await expect(
    transcript(page).getByText("What were the main action items from mentor hours?")
  ).toBeVisible();
});

test("Enter sends on a mouse-driven browser but never on a touch one", async ({
  page,
}, testInfo) => {
  await gotoChat(page);
  const composer = page.getByPlaceholder("Ask about your sessions…");

  await composer.fill("First line");
  await composer.press("Enter");

  if (isMobile(testInfo)) {
    // Soft keyboards have no Shift+Enter, so Enter-to-send would make
    // multiline input impossible rather than merely awkward.
    await expect(composer).toHaveValue("First line\n");
    await expect(transcript(page).getByText("validate the problem with users")).toBeHidden();
  } else {
    await expect(composer).toHaveValue("");
    await expect(transcript(page).getByText("validate the problem with users")).toBeVisible();
  }
});

test("Shift+Enter adds a newline instead of sending on desktop", async ({ page }, testInfo) => {
  test.skip(isMobile(testInfo), "Touch keyboards have no Shift+Enter");

  await gotoChat(page);
  const composer = page.getByPlaceholder("Ask about your sessions…");

  await composer.fill("First line");
  await composer.press("Shift+Enter");
  await composer.pressSequentially("second line");

  await expect(composer).toHaveValue("First line\nsecond line");
});

test("sending shows the question immediately, before any answer", async ({ page }) => {
  await gotoChat(page);
  await page.getByPlaceholder("Ask about your sessions…").fill("Summarise the MVP advice");
  await page.getByRole("button", { name: "Send message" }).click();

  // While the answer is in flight the only feedback is the question and the
  // thinking indicator, so both have to be on screen rather than below the fold.
  await expect(transcript(page).getByText("Summarise the MVP advice", { exact: true })).toBeInViewport();
  await expect(transcript(page).getByText("Thinking…")).toBeInViewport();
});

test("the answer pins the question that prompted it to the top", async ({ page }) => {
  await gotoChat(page);
  const composer = page.getByPlaceholder("Ask about your sessions…");
  await composer.fill("Summarise the MVP advice");
  await page.getByRole("button", { name: "Send message" }).click();

  const question = transcript(page).getByText("Summarise the MVP advice", { exact: true });
  await expect(question).toBeVisible();
  await expect(transcript(page).getByText("Thinking…")).toHaveCount(0);

  /*
   * Two assertions, because either alone passes for the wrong reason. The
   * offset alone is one-sided: scrolling to the bottom instead pushes the
   * question *above* the viewport, which is an even smaller number. The
   * distance-from-bottom alone would pass on any position that is not the
   * bottom. Together they say: the question is at the top, and there is
   * unread answer below it.
   */
  await expect
    .poll(async () => {
      const scroller = await page.locator("[data-chat-scroller]").boundingBox();
      const box = await question.boundingBox();
      if (!scroller || !box) return Number.NaN;
      return Math.round(box.y - scroller.y);
    })
    .toBeLessThan(120);

  const offset = await page.locator("[data-chat-scroller]").evaluate((element) => ({
    fromBottom: element.scrollHeight - element.scrollTop - element.clientHeight,
    overflows: element.scrollHeight > element.clientHeight + 1,
  }));
  expect(offset.overflows).toBe(true);
  expect(offset.fromBottom).toBeGreaterThan(0);

  const questionBox = await question.boundingBox();
  const scrollerBox = await page.locator("[data-chat-scroller]").boundingBox();
  expect(questionBox!.y - scrollerBox!.y).toBeGreaterThanOrEqual(-1);
});

test("scrolling up reveals jump-to-latest without moving the page", async ({ page }, testInfo) => {
  await gotoChat(page);
  const scroller = page.locator("[data-chat-scroller]");

  // Wait for the mount-time pin to the newest message, otherwise scrolling to
  // the top races it and lands back at the bottom with no pill to find.
  await expect.poll(() => scroller.evaluate((element) => element.scrollTop)).toBeGreaterThan(0);
  await scroller.evaluate((element) => element.scrollTo({ top: 0 }));

  const jump = page.getByRole("button", { name: "Jump to latest" });
  await expect(jump).toBeVisible();
  expect(await pageScrollOverflow(page)).toBeLessThanOrEqual(1);
  await shoot(page, testInfo, "jump-to-latest");

  await jump.click();
  await expect(jump).toBeHidden();
});

test("a new chat is not overwritten by an answer still in flight", async ({ page }, testInfo) => {
  await gotoChat(page);
  await page.getByPlaceholder("Ask about your sessions…").fill("Question A");
  await page.getByRole("button", { name: "Send message" }).click();

  // Abandon the conversation while the answer is still being fetched.
  await expect(transcript(page).getByText("Thinking…")).toBeVisible();
  await newChatControl(page, testInfo).click();
  await expect(page.getByRole("heading", { name: "Ask across your sessions" })).toBeVisible();

  /*
   * A fixed wait, deliberately: the assertion is that something never happens,
   * and the window it could happen in is the mock's round trip. Asserting
   * immediately would pass whether or not the guard exists, because the
   * transcript is empty either way until the abandoned answer lands. Derived
   * from the constant rather than hardcoded, so raising the mock latency cannot
   * silently turn this into an assertion about nothing.
   */
  await page.waitForTimeout(MOCK_LATENCY_MS * 2);

  await expect(transcript(page).getByText("Question A")).toHaveCount(0);
  await expect(transcript(page).getByText("validate the problem with users")).toHaveCount(0);
  await expect(page.getByRole("heading", { name: "Ask across your sessions" })).toBeVisible();
});

test("the header title opens the conversation sheet on mobile", async ({ page }, testInfo) => {
  test.skip(!isMobile(testInfo), "The sheet is the mobile switcher; desktop uses the rail");

  await gotoChat(page);
  await page.getByRole("button", { name: /Customer discovery next steps/ }).first().click();

  const sheet = page.getByRole("dialog");
  await expect(sheet).toBeVisible();
  await expect(sheet.getByRole("button", { name: /Architecture tradeoffs/ })).toBeVisible();
  await shoot(page, testInfo, "conversation-sheet");

  // Escape comes from the native <dialog>, not from a hand-rolled listener.
  await page.keyboard.press("Escape");
  await expect(sheet).toBeHidden();
});

test("switching conversation replaces the transcript and resets its scroll", async ({ page }) => {
  await gotoChat(page);
  const scroller = page.locator("[data-chat-scroller]");
  await expect.poll(() => scroller.evaluate((element) => element.scrollTop)).toBeGreaterThan(0);

  // Read backwards, so the reset has something to undo.
  await scroller.evaluate((element) => element.scrollTo({ top: 0 }));
  await expect(page.getByRole("button", { name: "Jump to latest" })).toBeVisible();

  await openConversationList(page);
  await page.getByRole("button", { name: /Architecture tradeoffs/ }).first().click();

  await expect(transcript(page).getByText("Should we move the retrieval layer")).toBeVisible();
  await expect(transcript(page).getByText("What should students do before")).toHaveCount(0);

  // Landing mid-history in a conversation you just opened is disorienting. Both
  // halves of the reset are checked: the pill is gone, and the scroll position
  // is actually at the bottom rather than inherited. The two conversations have
  // the same message count on purpose — that collision is what made counting
  // messages an unusable signal for "the transcript changed".
  await expect(page.getByRole("button", { name: "Jump to latest" })).toBeHidden();
  const position = await scroller.evaluate((element) => ({
    overflows: element.scrollHeight > element.clientHeight + 1,
    fromBottom: element.scrollHeight - element.scrollTop - element.clientHeight,
  }));
  expect(position.overflows).toBe(true);
  expect(position.fromBottom).toBeLessThanOrEqual(1);
});

test("switching conversation from the sheet closes it", async ({ page }, testInfo) => {
  test.skip(!isMobile(testInfo), "The sheet is the mobile switcher; desktop uses the rail");

  await gotoChat(page);
  await page.getByRole("button", { name: /Customer discovery next steps/ }).first().click();
  await page.getByRole("dialog").getByRole("button", { name: /Architecture tradeoffs/ }).click();

  await expect(page.getByRole("dialog")).toBeHidden();
  await expect(page.getByRole("button", { name: /Architecture tradeoffs/ })).toBeVisible();
});

test("the desktop rail keeps a route back into the dashboard", async ({ page }, testInfo) => {
  test.skip(isMobile(testInfo), "The rail is desktop-only; mobile uses the header back arrow");

  await gotoChat(page);
  await expect(page.getByRole("link", { name: "Back to dashboard" })).toBeVisible();
  await expect(page.getByRole("navigation", { name: "Site" })).toBeVisible();
});

test("a conversation still loading does not replace a new chat", async ({ page }, testInfo) => {
  // The default load time is honest about production and too short to act in,
  // so widen it for this test rather than slowing the page for everyone.
  await gotoChat(page, `?mockLoad=${SLOW_LOAD_MS}`);

  await openConversationList(page);
  await page.getByRole("button", { name: /Architecture tradeoffs/ }).first().click();
  // Tapping a conversation must say something before the fetch lands.
  await expect(transcript(page).getByText("Loading conversation…")).toBeVisible();

  // Abandon the load before it does.
  await newChatControl(page, testInfo).click();
  await expect(page.getByRole("heading", { name: "Ask across your sessions" })).toBeVisible();

  // Same reasoning as the in-flight send: the assertion is that a late response
  // never lands, so it has to outlast the window in which it could.
  await page.waitForTimeout(SLOW_LOAD_MS * 2);

  await expect(transcript(page).getByText("Should we move the retrieval layer")).toHaveCount(0);
  await expect(page.getByRole("heading", { name: "Ask across your sessions" })).toBeVisible();
});
