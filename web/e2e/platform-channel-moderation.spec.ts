import { expect, test, type Page } from "@playwright/test";
import { runAxe } from "./platform-axe";

/**
 * Reporting, hiding and restoring, and asking for a review (U-2.2), on the
 * DEV-only channel harness, whose fixture API answers as B-2.5's routes are
 * specified in contracts.ts. Unit tests cover the rules and copy; this covers
 * what a browser shows: the flows by pointer and by keyboard, focus, the live
 * region, axe, and the forms at 390 and 1440 px.
 */
const HARNESS = "/dev/platform-channel";
const EVIDENCE_DIR = "test-results/evidence/platform-channel-moderation";
const PHONE = { width: 390, height: 844 };
const DESKTOP = { width: 1440, height: 900 };
const FIRST_PR = "s00000000000000000000407"; // Brian's, in #show-your-work
const MENTOR_OFFER = "s00000000000000000000408"; // Mercy's, the newest in #show-your-work
const HIDDEN = "s00000000000000000000423"; // Dennis's, hidden with a reason
const HIDDEN_ASKED = "s00000000000000000000424"; // Dennis's, hidden, and he already asked for a review

function harness(params: Record<string, string>) {
  return `${HARNESS}?${new URLSearchParams({ channel: "show-your-work", ...params })}`;
}

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

async function open(page: Page, path: string) {
  await routeFonts(page);
  await page.goto(path);
  await expect(page.locator("astro-island[ssr]")).toHaveCount(0);
  await page.waitForFunction(() => typeof window.__channelHarness?.moderation === "function");
  await page.evaluate(() => document.fonts.ready);
}

const message = (page: Page, id: string) => page.locator(`[data-message="${id}"]`);
const actions = (page: Page, id: string) => message(page, id).getByRole("button", { name: /^Actions for/ });
const records = (page: Page) => page.evaluate(() => window.__channelHarness!.moderation());
const announcer = (page: Page) => page.locator("[data-channel-announcer]");

async function horizontalOverflow(page: Page) {
  return page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
}

// Locally each test sets its own viewport and input, so one project runs them.
test.beforeEach(({ browserName }, testInfo) => {
  test.skip(!process.env.PLAYWRIGHT_BASE_URL && testInfo.project.name !== "chromium", `covered by the chromium project (${browserName})`);
});

test.describe("moderation in a channel", () => {
  test.skip(Boolean(process.env.PLAYWRIGHT_BASE_URL), "The harness exists only in astro dev.");

  for (const viewport of [DESKTOP, PHONE]) {
    test(`a member reports a message at ${viewport.width}px`, async ({ page }, testInfo) => {
      await page.setViewportSize(viewport);
      await open(page, harness({ persona: "wanjiku" }));
      await actions(page, MENTOR_OFFER).click();
      await expect(page.getByRole("menuitem", { name: "Hide from members…" })).toHaveCount(0);
      await page.getByRole("menuitem", { name: "Report…" }).click();

      const form = page.locator("[data-panel=report]");
      await expect(form).toBeInViewport({ ratio: 1 });
      await expect(form.getByRole("radio").first()).toBeFocused();
      expect(await horizontalOverflow(page)).toBe(0);
      await page.screenshot({ path: `${EVIDENCE_DIR}/report-form-${viewport.width}.png` });
      await runAxe(page, testInfo, `report-form-${viewport.width}`);

      await form.getByLabel("Spam or unrelated promotion").check();
      await form.getByLabel(/Add details/).fill("Posted in three channels today.");
      await form.getByRole("button", { name: "Send report" }).click();

      await expect(form).toHaveCount(0);
      await expect(message(page, MENTOR_OFFER).locator("[data-reported]")).toHaveText("You reported this. A moderator will look at it.");
      await expect(announcer(page)).toHaveText("Reported. A moderator will look at it.");
      await expect(actions(page, MENTOR_OFFER)).toBeFocused();
      expect(await records(page)).toEqual([
        { kind: "report", messageId: MENTOR_OFFER, reason: "Spam or unrelated promotion: Posted in three channels today." },
      ]);
      await actions(page, MENTOR_OFFER).click();
      await expect(page.getByRole("menuitem", { name: "Reported" })).toBeDisabled();
      await page.screenshot({ path: `${EVIDENCE_DIR}/reported-${viewport.width}.png` });
      await page.keyboard.press("Escape");
    });

    test(`a mentor hides a message with a reason at ${viewport.width}px`, async ({ page }, testInfo) => {
      await page.setViewportSize(viewport);
      await open(page, harness({ persona: "david" }));
      await actions(page, FIRST_PR).click();
      await page.getByRole("menuitem", { name: "Hide from members…" }).click();

      const form = page.locator("[data-panel=hide]");
      const reason = form.getByLabel("Why are you hiding it?");
      await expect(reason).toBeFocused();
      await expect(form).toContainText("Brian will still see it, with your reason, and can ask for a review. An admin looks at every hide and can restore it.");
      await expect(form.getByRole("button", { name: "Hide message" })).toBeDisabled();
      await expect(form).toBeInViewport({ ratio: 1 });
      expect(await horizontalOverflow(page)).toBe(0);
      await page.screenshot({ path: `${EVIDENCE_DIR}/hide-form-${viewport.width}.png` });
      await runAxe(page, testInfo, `hide-form-${viewport.width}`);

      await reason.fill("Off-topic for this channel");
      await form.getByRole("button", { name: "Hide message" }).click();
      await expect(form).toHaveCount(0);
      const note = message(page, FIRST_PR).locator("[data-moderation=HIDDEN]");
      await expect(note).toHaveText("Hidden from members: Off-topic for this channel. Moderators can still see it.");
      await expect(announcer(page)).toHaveText("Message hidden from members.");
      await expect(actions(page, FIRST_PR)).toBeFocused();
      await page.screenshot({ path: `${EVIDENCE_DIR}/hidden-${viewport.width}.png` });
      await runAxe(page, testInfo, `hidden-${viewport.width}`);

      // Hidden: no reactions, and restoring is an admin's decision.
      await actions(page, FIRST_PR).click();
      await expect(page.getByRole("menuitem", { name: "Congrats" })).toHaveCount(0);
      await expect(page.getByRole("menuitem", { name: "Restore for members…" })).toHaveCount(0);
      await page.keyboard.press("Escape");
      expect(await records(page)).toEqual([{ kind: "hide", messageId: FIRST_PR, reason: "Off-topic for this channel" }]);
    });

    test(`an admin restores a hidden message at ${viewport.width}px`, async ({ page }, testInfo) => {
      await page.setViewportSize(viewport);
      await open(page, harness({ persona: "amina" }));
      await actions(page, HIDDEN).click();
      await page.getByRole("menuitem", { name: "Restore for members…" }).click();
      const form = page.locator("[data-panel=restore]");
      await expect(form.getByLabel("Why can it come back?")).toBeFocused();
      await page.screenshot({ path: `${EVIDENCE_DIR}/restore-form-${viewport.width}.png` });
      await runAxe(page, testInfo, `restore-form-${viewport.width}`);
      await form.getByLabel("Why can it come back?").fill("Talked it through; it's fine");
      await form.getByRole("button", { name: "Restore message" }).click();
      await expect(message(page, HIDDEN).locator("[data-moderation]")).toHaveCount(0);
      await expect(announcer(page)).toHaveText("Message restored. Members can see it again.");
      expect(await records(page)).toEqual([{ kind: "restore", messageId: HIDDEN, reason: "Talked it through; it's fine" }]);
    });

    test(`the author of a hidden message asks for a review at ${viewport.width}px`, async ({ page }, testInfo) => {
      await page.setViewportSize(viewport);
      await open(page, harness({ persona: "dennis" }));
      const own = message(page, HIDDEN);
      await expect(own.locator("[data-moderation=HIDDEN]")).toContainText("Hidden from the channel: Harsh, not about the work. Only you can see this message now.");
      await own.getByRole("button", { name: "Ask for review" }).click();
      const form = page.locator("[data-panel=review]");
      await expect(form.getByLabel(/Anything the reviewer should know/)).toBeFocused();
      await expect(form).toBeInViewport({ ratio: 1 });
      await page.screenshot({ path: `${EVIDENCE_DIR}/review-form-${viewport.width}.png` });
      await runAxe(page, testInfo, `review-form-${viewport.width}`);

      await form.getByLabel(/Anything the reviewer should know/).fill("I meant the pattern, not the person.");
      await form.getByRole("button", { name: "Ask for review" }).click();
      await expect(own.locator("[data-review-requested]")).toBeFocused();
      await expect(own.getByRole("button", { name: "Ask for review" })).toHaveCount(0);
      expect(await records(page)).toEqual([{ kind: "review", messageId: HIDDEN, note: "I meant the pattern, not the person." }]);
      await page.screenshot({ path: `${EVIDENCE_DIR}/review-requested-${viewport.width}.png` });
    });
  }

  test("reporting works from the keyboard alone, and Escape backs out", async ({ page }) => {
    await page.setViewportSize(DESKTOP);
    await open(page, harness({ persona: "wanjiku" }));
    await actions(page, FIRST_PR).focus();
    await page.keyboard.press("Enter");
    // The menu keeps focus and marks the active item (Headless UI's menu pattern).
    await expect(page.getByRole("menuitem").first()).toHaveAttribute("data-focus", "");
    // The report item sits at the end of the menu.
    await page.keyboard.press("End");
    await expect(page.getByRole("menuitem", { name: "Report…" })).toHaveAttribute("data-focus", "");
    await page.keyboard.press("Enter");
    const form = page.locator("[data-panel=report]");
    await expect(form.getByRole("radio", { name: "Unkind or disrespectful" })).toBeFocused();
    await page.keyboard.press("Escape");
    await expect(form).toHaveCount(0);
    await expect(actions(page, FIRST_PR)).toBeFocused();

    await page.keyboard.press("Enter");
    await page.keyboard.press("End");
    await page.keyboard.press("Enter");
    await page.keyboard.press("ArrowDown"); // radios move and choose with the arrow keys
    await expect(form.getByRole("radio", { name: "Spam or unrelated promotion" })).toBeChecked();
    await page.keyboard.press("Tab");
    await expect(form.getByLabel(/Add details/)).toBeFocused();
    await page.keyboard.press("Tab");
    await expect(form.getByRole("button", { name: "Send report" })).toBeFocused();
    await page.keyboard.press("Enter");
    await expect(form).toHaveCount(0);
    expect(await records(page)).toEqual([{ kind: "report", messageId: FIRST_PR, reason: "Spam or unrelated promotion" }]);
  });

  test("a refused hide says why, keeps the reason, and leaves the message as it was", async ({ page }) => {
    await page.setViewportSize(DESKTOP);
    await open(page, harness({ persona: "david" }));
    await page.evaluate(() => window.__channelHarness!.refuseWrites(1, 409, "conflict", "Already changed"));
    await actions(page, FIRST_PR).click();
    await page.getByRole("menuitem", { name: "Hide from members…" }).click();
    const form = page.locator("[data-panel=hide]");
    await form.getByLabel("Why are you hiding it?").fill("Off-topic");
    await form.getByRole("button", { name: "Hide message" }).click();
    await expect(form.getByRole("alert")).toHaveText("An admin has already decided on this message, or it has changed. Close this and look again.");
    await expect(form.getByLabel("Why are you hiding it?")).toHaveValue("Off-topic");
    await expect(message(page, FIRST_PR).locator("[data-moderation]")).toHaveCount(0);
    expect(await records(page)).toEqual([]);
  });

  test("a refused report says why, keeps the form, and reports nothing", async ({ page }) => {
    await page.setViewportSize(DESKTOP);
    await open(page, harness({ persona: "wanjiku" }));
    await page.evaluate(() => window.__channelHarness!.refuseWrites(1, 429, "rate_limited", "Slow down", 4_000));
    await actions(page, FIRST_PR).click();
    await page.getByRole("menuitem", { name: "Report…" }).click();
    const form = page.locator("[data-panel=report]");
    await form.getByRole("radio", { name: "Unkind or disrespectful" }).check();
    await form.getByRole("button", { name: "Send report" }).click();
    await expect(form.getByRole("alert")).toHaveText("That's a lot at once. Try again in 4 seconds.");
    await expect(form.getByRole("button", { name: "Send report" })).toBeEnabled();
    await expect(message(page, FIRST_PR).locator("[data-reported]")).toHaveCount(0);
    expect(await records(page)).toEqual([]);
  });

  test("a refused restore says why and leaves the message hidden", async ({ page }) => {
    await page.setViewportSize(DESKTOP);
    await open(page, harness({ persona: "amina" }));
    await page.evaluate(() => window.__channelHarness!.refuseWrites(1, 409, "conflict", "Already decided"));
    await actions(page, HIDDEN).click();
    await page.getByRole("menuitem", { name: "Restore for members…" }).click();
    const form = page.locator("[data-panel=restore]");
    await form.getByLabel("Why can it come back?").fill("Fine on reflection");
    await form.getByRole("button", { name: "Restore message" }).click();
    await expect(form.getByRole("alert")).toHaveText("An admin has already decided on this message, or it has changed. Close this and look again.");
    await expect(message(page, HIDDEN).locator("[data-moderation=HIDDEN]")).toHaveCount(1);
    expect(await records(page)).toEqual([]);
  });

  test("a refused review request says why, from the keyboard, and Cancel returns to the button", async ({ page }) => {
    await page.setViewportSize(PHONE);
    await open(page, harness({ persona: "dennis" }));
    await page.evaluate(() => window.__channelHarness!.refuseWrites(1, 409, "conflict", "An admin has already reviewed this message."));
    const ask = message(page, HIDDEN).getByRole("button", { name: "Ask for review" });
    await ask.focus();
    await page.keyboard.press("Enter");
    const form = page.locator("[data-panel=review]");
    await expect(form.getByLabel(/Anything the reviewer should know/)).toBeFocused();
    await form.getByRole("button", { name: "Ask for review" }).press("Enter");
    await expect(form.getByRole("alert")).toHaveText("An admin has already decided on this message, or it is no longer hidden. Close this and look again.");
    await form.getByRole("button", { name: "Cancel" }).click();
    await expect(ask).toBeFocused();
    await expect(message(page, HIDDEN).locator("[data-review-requested]")).toHaveCount(0);
    expect(await records(page)).toEqual([]);
  });

  test("a review already asked for says so on arrival, and is not offered again; a mentor is not told", async ({ page }) => {
    await page.setViewportSize(DESKTOP);
    await open(page, harness({ persona: "dennis" }));
    const asked = message(page, HIDDEN_ASKED);
    await expect(asked.locator("[data-review-requested]")).toHaveText("Review requested. An admin will look at it again.");
    await expect(asked.getByRole("button", { name: "Ask for review" })).toHaveCount(0);

    await open(page, harness({ persona: "david" }));
    await expect(message(page, HIDDEN_ASKED).locator("[data-moderation=HIDDEN]")).toHaveCount(1);
    await expect(message(page, HIDDEN_ASKED).locator("[data-review-requested]")).toHaveCount(0);
  });

  test("members never see Hide, and nobody reports their own message", async ({ page }) => {
    await page.setViewportSize(DESKTOP);
    await open(page, harness({ persona: "brian" }));
    await actions(page, FIRST_PR).click();
    await expect(page.getByRole("menuitem", { name: "Report…" })).toHaveCount(0);
    await expect(page.getByRole("menuitem", { name: "Hide from members…" })).toHaveCount(0);
    await page.keyboard.press("Escape");
    await actions(page, MENTOR_OFFER).click();
    await expect(page.getByRole("menuitem", { name: "Report…" })).toBeVisible();
    await expect(page.getByRole("menuitem", { name: "Hide from members…" })).toHaveCount(0);
    // Members do not receive hidden messages at all.
    await expect(message(page, HIDDEN)).toHaveCount(0);
  });

  test("the form opens out of its message, and is a cut with reduced motion", async ({ page }) => {
    await page.setViewportSize(DESKTOP);
    await open(page, harness({ persona: "wanjiku" }));
    await actions(page, FIRST_PR).click();
    await page.getByRole("menuitem", { name: "Report…" }).click();
    expect(await page.locator("[data-panel=report]").evaluate((el) => getComputedStyle(el).animationName)).toBe("channel-panel-in");

    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.keyboard.press("Escape");
    await actions(page, FIRST_PR).click();
    await page.getByRole("menuitem", { name: "Report…" }).click();
    expect(await page.locator("[data-panel=report]").evaluate((el) => getComputedStyle(el).animationName)).toBe("none");
  });
});
