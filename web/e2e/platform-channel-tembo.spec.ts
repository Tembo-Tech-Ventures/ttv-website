import { expect, test, type Page } from "@playwright/test";
import { runAxe } from "./platform-axe";

/**
 * Tembo in a channel (U-3.1 / S-3.1), on the DEV-only harness `/dev/platform-channel`: the real
 * ChannelSurface, channel store, composer and Tembo store over a fixture API that answers like
 * B-3.1. Ask → pending → the answer arrives by polling → Helpful; and an exhausted allowance.
 * Unit tests hold the timeout, the error states and the feedback rollback.
 */
const HARNESS = "/dev/platform-channel";
const EVIDENCE_DIR = "test-results/evidence/platform-channel-tembo";
const PHONE = { width: 390, height: 844 };
const DESKTOP = { width: 1440, height: 900 };

function harness(params: Record<string, string> = {}) {
  return `${HARNESS}?${new URLSearchParams({ persona: "wanjiku", channel: "show-your-work", ...params })}`;
}

async function open(page: Page, path: string) {
  await page.route(/fonts\.(googleapis|gstatic)\.com/, (route) => route.abort());
  await page.goto(path);
  await expect(page.locator("astro-island[ssr]")).toHaveCount(0);
  await page.waitForFunction(() => typeof window.__channelHarness?.answerTembo === "function");
}

async function ask(page: Page, words: string) {
  const box = page.locator("[data-composer=channel] textarea");
  await box.fill(words);
  await box.press("Enter");
}

const horizontalOverflow = (page: Page) => page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);

for (const viewport of [DESKTOP, PHONE]) {
  test(`ask → pending → answer → feedback at ${viewport.width}px`, async ({ page }, testInfo) => {
    await page.setViewportSize(viewport);
    await open(page, harness());
    await expect(page.locator(".channel-composer__scope")).toContainText("You: 6 of 10 today");

    await ask(page, "@tembo what changed between revisions 2 and 3?");
    const waiting = page.locator("[data-tembo-question=pending]");
    await expect(waiting).toHaveText("Tembo is answering in the thread.");
    await expect(page.locator("[data-channel-announcer]")).toHaveText("Tembo is looking into it");
    expect(await horizontalOverflow(page)).toBe(0);
    await page.screenshot({ path: `${EVIDENCE_DIR}/01-pending-${viewport.width}.png` });
    await runAxe(page, testInfo, `tembo-pending-${viewport.width}`);

    expect(await page.evaluate(() => window.__channelHarness!.answerTembo())).toBe(1);
    await expect(waiting).toHaveCount(0);
    const asked = (await page.evaluate(() => window.__channelHarness!.tembo().asked))[0];
    const trigger = page.locator(`[data-thread-trigger="${asked}"]`);
    await expect(trigger).toContainText("1 reply");

    // Keyboard: the thread opens from its link, and the answer's choices are reachable by Tab.
    await trigger.focus();
    await page.keyboard.press("Enter");
    await expect(page.locator("#channel-thread-title")).toBeFocused();
    const answer = page.locator("[data-thread-rail] [data-message]").filter({ has: page.locator(".channel-tembo") }).last();
    await expect(answer.locator(".channel-ai-badge")).toHaveText("AI");
    await expect(answer.locator(".channel-tembo__foot")).toContainText("Sees: this channel, projects shared in it and public builder profiles · You: 7 of 10 today");
    const helpful = answer.locator("[data-tembo-feedback=helpful]");
    await helpful.focus();
    await page.keyboard.press("Enter");
    await expect(helpful).toHaveAttribute("aria-pressed", "true");
    await expect(page.locator("[data-channel-announcer]")).toHaveText("Thanks: marked helpful");
    expect(await page.evaluate(() => window.__channelHarness!.tembo().feedback)).toEqual([
      { messageId: await answer.getAttribute("data-message"), feedback: "helpful" },
    ]);
    const box = await helpful.boundingBox();
    expect(box!.height).toBeGreaterThanOrEqual(viewport.width < 1024 ? 32 : 28);
    expect(await horizontalOverflow(page)).toBe(0);
    await page.screenshot({ path: `${EVIDENCE_DIR}/02-answer-${viewport.width}.png` });
    await runAxe(page, testInfo, `tembo-answer-${viewport.width}`);
  });

  test(`a question in a thread waits there at ${viewport.width}px`, async ({ page }, testInfo) => {
    await page.setViewportSize(viewport);
    await open(page, harness({ thread: "s00000000000000000000401" }));
    const box = page.locator("[data-composer=thread] textarea");
    await box.fill("@tembo does revision 3 change the replay test?");
    await box.press("Enter");
    const waiting = page.locator("[data-thread-rail] [data-tembo-question=pending]");
    await expect(waiting).toContainText("The answer will appear here.");
    await expect(waiting.locator(".channel-ai-badge")).toHaveText("AI");
    await page.screenshot({ path: `${EVIDENCE_DIR}/03-thread-pending-${viewport.width}.png` });
    await runAxe(page, testInfo, `tembo-thread-pending-${viewport.width}`);
    await page.evaluate(() => window.__channelHarness!.answerTembo());
    await expect(waiting).toHaveCount(0);
    await expect(page.locator("[data-thread-rail] .channel-tembo").last()).toContainText("Revision 3 logs each callback");
  });

  test(`out of questions today at ${viewport.width}px`, async ({ page }, testInfo) => {
    await page.setViewportSize(viewport);
    await open(page, harness({ "tembo-used": "10" }));
    await ask(page, "@tembo one more?");
    const line = page.locator("[data-tembo-question=exhausted]");
    await expect(line).toContainText("You've used all 10 of today's questions to Tembo, so this one wasn't asked.");
    await expect(line).toContainText("You can ask again after midnight East Africa Time, in");
    await expect(page.locator("[data-channel-announcer]")).toHaveText("You've used today's questions to Tembo");
    expect(await page.evaluate(() => window.__channelHarness!.tembo().asked)).toEqual([]);
    expect(await horizontalOverflow(page)).toBe(0);
    await page.screenshot({ path: `${EVIDENCE_DIR}/04-exhausted-${viewport.width}.png` });
    await runAxe(page, testInfo, `tembo-exhausted-${viewport.width}`);
  });
}

test("with tembo_channels off, nothing is asked and nothing is rated", async ({ page }) => {
  await open(page, harness({ tembo: "off", thread: "s00000000000000000000401" }));
  await expect(page.locator("[data-tembo-feedback]")).toHaveCount(0);
  await ask(page, "@tembo hello");
  await expect(page.locator("[data-composer=channel] textarea")).toHaveValue("");
  await expect(page.locator("[data-tembo-question]")).toHaveCount(0);
  expect(await page.evaluate(() => window.__channelHarness!.tembo().asked)).toEqual([]);
});
