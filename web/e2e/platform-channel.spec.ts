import { expect, test, type Page } from "@playwright/test";
import { runAxe } from "./platform-axe";

/**
 * The browser contract for the channel view (U-2.1), on the DEV-only harness
 * `/dev/platform-channel`, which renders the same ChannelSurface the channel
 * frame mounts, on fixture data. Unit tests cover markup, states and the
 * composer's rules; this covers what only a browser can see: layout at 390
 * and 1440 px, one scroll surface, axe, keyboard order, focus, the live
 * region, scroll following and "Jump to latest", touch Enter, and motion.
 */
const HARNESS = "/dev/platform-channel";
const EVIDENCE_DIR = "test-results/evidence/platform-channel";
const PHONE = { width: 390, height: 844 };
const DESKTOP = { width: 1440, height: 900 };
const SWEEP = [320, 360, 390, 414, 600, 768, 1023, 1024, 1180, 1280, 1440];
const COMMUNITY_THREAD = "s00000000000000000000401";
const COHORT_THREAD = "s00000000000000000000412";

function harness(params: Record<string, string> = {}) {
  return `${HARNESS}?${new URLSearchParams({ persona: "wanjiku", channel: "show-your-work", ...params })}`;
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
  await page.evaluate(() => document.fonts.ready);
}

const scroller = (page: Page) => page.locator("[data-channel-scroller]");
const composer = (page: Page, which: "channel" | "thread" = "channel") => page.locator(`[data-composer=${which}] textarea`);

async function horizontalOverflow(page: Page) {
  return page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
}

/** Every element that scrolls vertically right now, by its data attribute or class. */
async function scrollingRegions(page: Page) {
  return page.evaluate(() =>
    [...document.querySelectorAll<HTMLElement>("body *")]
      .filter((el) => {
        const style = getComputedStyle(el);
        return /(auto|scroll)/.test(style.overflowY) && el.scrollHeight > el.clientHeight + 1 && el.offsetParent !== null;
      })
      .map((el) => el.className.toString().split(" ")[0]),
  );
}

/** Other people's messages, delivered by the harness through the next poll. */
async function arrive(page: Page, count: number) {
  await page.waitForFunction(() => typeof window.__channelHarness?.arrive === "function");
  await page.evaluate((n) => window.__channelHarness!.arrive(n), count);
}

async function atEnd(page: Page) {
  return scroller(page).evaluate((el) => el.scrollHeight - el.scrollTop - el.clientHeight < 100);
}

// Locally each test sets its own viewport, input and motion, so one project runs them.
test.beforeEach(({ browserName }, testInfo) => {
  test.skip(!process.env.PLAYWRIGHT_BASE_URL && testInfo.project.name !== "chromium", `covered by the chromium project (${browserName})`);
});

test.describe("on a deployed build", () => {
  test.skip(!process.env.PLAYWRIGHT_BASE_URL, "Only deployed builds prove the harness is absent.");

  test("the channel harness does not exist", async ({ page }) => {
    const response = await page.goto(harness());
    expect(response?.status()).toBe(404);
  });
});

test.describe("the channel view", () => {
  test.skip(Boolean(process.env.PLAYWRIGHT_BASE_URL), "The harness exists only in astro dev.");

  test("renders nothing while the channels flag is off", async ({ page }) => {
    await open(page, harness({ channels: "off" }));
    await expect(page.locator(".channel-view")).toHaveCount(0);
    await expect(page.locator("[data-composer]")).toHaveCount(0);
  });

  for (const viewport of [DESKTOP, PHONE]) {
    test(`community channel and thread at ${viewport.width}px: axe, containment, one scroll surface`, async ({ page }, testInfo) => {
      await page.setViewportSize(viewport);
      await open(page, harness());
      await expect(page.locator(`[data-message="${COMMUNITY_THREAD}"]`)).toBeVisible();
      expect(await horizontalOverflow(page)).toBe(0);
      expect(await page.evaluate(() => document.scrollingElement!.scrollTop)).toBe(0);
      // One scroll surface for the channel; nothing else on the page scrolls.
      expect(await scrollingRegions(page)).toEqual(["channel-list__scroller"]);
      await page.screenshot({ path: `${EVIDENCE_DIR}/01-community-${viewport.width}.png` });
      await runAxe(page, testInfo, `community-${viewport.width}`);

      await page.locator(`[data-thread-trigger="${COMMUNITY_THREAD}"]`).click();
      await expect(page.locator("[data-thread-rail]")).toBeVisible();
      await expect(page.locator("#channel-thread-title")).toBeFocused();
      expect(await horizontalOverflow(page)).toBe(0);
      const wide = viewport.width >= 1024;
      // Wide: two columns; narrow: the thread replaces the list, which leaves the page.
      await expect(page.locator(".channel-view__main")).toHaveCSS("visibility", wide ? "visible" : "hidden");
      await page.screenshot({ path: `${EVIDENCE_DIR}/01-thread-${viewport.width}.png` });
      await runAxe(page, testInfo, `community-thread-${viewport.width}`);
    });

    test(`cohort channel with a Tembo thread at ${viewport.width}px`, async ({ page }, testInfo) => {
      await page.setViewportSize(viewport);
      await open(page, harness({ channel: "cohort-04", thread: COHORT_THREAD }));
      await expect(page.locator("[data-thread-rail] [data-tembo-mark]").first()).toBeVisible();
      await expect(page.locator("[data-thread-rail] .channel-cite")).toHaveCount(2);
      expect(await horizontalOverflow(page)).toBe(0);
      await page.screenshot({ path: `${EVIDENCE_DIR}/02-cohort-thread-${viewport.width}.png` });
      await runAxe(page, testInfo, `cohort-thread-${viewport.width}`);
    });
  }

  test("no sideways scrolling from 320 to 1440 px, with and without a thread", async ({ page }) => {
    await open(page, harness({ channel: "cohort-04" }));
    for (const width of SWEEP) {
      await page.setViewportSize({ width, height: 800 });
      expect(await horizontalOverflow(page), `channel at ${width}`).toBe(0);
    }
    await open(page, harness({ channel: "cohort-04", thread: COHORT_THREAD }));
    for (const width of SWEEP) {
      await page.setViewportSize({ width, height: 800 });
      expect(await horizontalOverflow(page), `thread at ${width}`).toBe(0);
      // Nothing inside the view is wider than its box.
      const spill = await page.evaluate(() => {
        const view = document.querySelector(".channel-view")!.getBoundingClientRect();
        return [...document.querySelectorAll<HTMLElement>(".channel-view *")]
          .filter((el) => el.offsetParent !== null && getComputedStyle(el).visibility !== "hidden")
          .filter((el) => {
            const box = el.getBoundingClientRect();
            return box.width > 0 && (box.right > view.right + 1 || box.left < view.left - 1);
          })
          .map((el) => el.className.toString().split(" ")[0]);
      });
      expect(spill, `spill at ${width}`).toEqual([]);
    }
  });

  test("keyboard order: messages, then the composer and its tools, then send", async ({ page }) => {
    await page.setViewportSize(DESKTOP);
    await open(page, harness({ channel: "cohort-04" }));
    await scroller(page).focus();
    const order: string[] = [];
    for (let i = 0; i < 40; i += 1) {
      await page.keyboard.press("Tab");
      const label = await page.evaluate(() => {
        const el = document.activeElement as HTMLElement | null;
        if (!el || !el.closest(".channel-view")) return "outside";
        return el.dataset.threadTrigger ? "thread-link" : el.tagName === "TEXTAREA" ? "composer" : (el.getAttribute("aria-label") ?? el.textContent ?? "").trim();
      });
      order.push(label);
      if (label === "Send message" || label === "outside") break;
    }
    const at = (name: string) => order.indexOf(name);
    expect(at("thread-link")).toBeGreaterThanOrEqual(0);
    expect(at("thread-link")).toBeLessThan(at("composer"));
    expect(at("composer")).toBeLessThan(at("Share project"));
    expect(at("Share project")).toBeLessThan(at("Session clip"));
    expect(at("Session clip")).toBeLessThan(at("Ask Tembo"));
    expect(at("Ask Tembo")).toBeLessThan(at("Send message"));
  });

  test("Escape closes a thread and returns focus to its link; Back closes it too", async ({ page }) => {
    await page.setViewportSize(PHONE);
    await open(page, harness());
    const trigger = page.locator(`[data-thread-trigger="${COMMUNITY_THREAD}"]`);
    await trigger.click();
    await expect(page).toHaveURL(new RegExp(`thread=${COMMUNITY_THREAD}`));
    await page.keyboard.press("Escape");
    await expect(page.locator("[data-thread-rail]")).toHaveCount(0);
    await expect(trigger).toBeFocused();
    await expect(page).not.toHaveURL(/thread=/);

    await trigger.click();
    await expect(page.getByRole("button", { name: "Back to channel" })).toBeVisible();
    await page.goBack();
    await expect(page.locator("[data-thread-rail]")).toHaveCount(0);
    await expect(page.locator(".channel-view__main")).toHaveCSS("visibility", "visible");
  });

  test("new messages are announced once, followed at the end, and offered by Jump to latest when reading above", async ({ page }) => {
    await page.setViewportSize(PHONE);
    await open(page, harness({ channel: "cohort-04" }));
    await expect.poll(() => atEnd(page)).toBe(true);
    const announcer = page.locator("[data-channel-announcer]");
    await expect(announcer).toHaveAttribute("aria-live", "polite");

    await arrive(page, 2);
    await expect(announcer).toHaveText("2 new messages");
    await expect.poll(() => atEnd(page)).toBe(true);
    await expect(page.locator("[data-jump-latest]")).toHaveCount(0);

    await scroller(page).evaluate((el) => el.scrollTo({ top: 0 }));
    await expect(page.locator("[data-jump-latest]")).toBeVisible();
    await arrive(page, 1);
    await expect(announcer).toHaveText("1 new message");
    // Reading above: the list does not jump to the new message.
    expect(await scroller(page).evaluate((el) => el.scrollTop)).toBeLessThan(50);
    await page.locator("[data-jump-latest]").click();
    await expect.poll(() => atEnd(page)).toBe(true);
    await expect(scroller(page)).toBeFocused();
    await page.screenshot({ path: `${EVIDENCE_DIR}/live-arrivals-390.png` });
  });

  test("the mention list shows Tembo's reach and allowance, and is keyboard driven (m4)", async ({ page }, testInfo) => {
    await page.setViewportSize(PHONE);
    await open(page, harness({ thread: COMMUNITY_THREAD }));
    const box = composer(page, "thread");
    await box.click();
    await box.pressSequentially("@");
    const list = page.getByRole("listbox", { name: "Suggestions" });
    await expect(list).toBeVisible();
    await expect(list.getByRole("option").first()).toContainText("@tembo");
    await expect(page.locator(".channel-mentions__scope")).toContainText("You: 6 of 10 today.");
    await page.screenshot({ path: `${EVIDENCE_DIR}/m4-mention-390.png` });
    await runAxe(page, testInfo, "mention-list-390");
    await page.keyboard.press("Enter");
    await expect(box).toHaveValue("@tembo ");
    await expect(list).toHaveCount(0);
  });

  test("Ask Tembo and @tembo are absent while tembo_channels is off", async ({ page }) => {
    await open(page, harness({ tembo: "off" }));
    await expect(page.getByRole("button", { name: "Ask Tembo" })).toHaveCount(0);
    await composer(page).fill("@t");
    await expect(page.locator("[data-mention-option=tembo]")).toHaveCount(0);
  });

  test("Session clip is offered in a cohort channel, never in community", async ({ page }) => {
    await page.setViewportSize(DESKTOP);
    await open(page, harness({ channel: "cohort-04" }));
    await page.getByRole("button", { name: "Session clip" }).click();
    await page.getByRole("menuitem", { name: /Webhooks and retries/ }).click();
    await expect(page.locator(".channel-attached")).toContainText("Session 9 · Webhooks and retries · 34:12");
    await open(page, harness());
    await expect(page.getByRole("button", { name: "Session clip" })).toHaveCount(0);
    await page.setViewportSize(PHONE);
    await page.getByRole("button", { name: "Attach work" }).click();
    await expect(page.getByRole("menu")).not.toContainText("session clip");
  });

  test("a sent message lands at the end, reacting works, and the author can edit and delete it", async ({ page }) => {
    await page.setViewportSize(DESKTOP);
    await open(page, harness());
    await composer(page).fill("Sharing my fare splitter for feedback");
    await page.keyboard.press("Enter");
    const mine = page.locator("[data-own] ").filter({ hasText: "Sharing my fare splitter" });
    await expect(mine).toBeVisible();
    await expect(composer(page)).toHaveValue("");
    await expect.poll(() => atEnd(page)).toBe(true);
    await expect(page.locator("[data-channel-announcer]")).toHaveText("");

    await mine.getByRole("button", { name: /Actions for/ }).click();
    await page.getByRole("menuitem", { name: "Edit" }).click();
    await page.getByRole("textbox", { name: "Edit your message" }).fill("Sharing my fare splitter, revision 4");
    await page.keyboard.press("Enter");
    await expect(page.locator("[data-own]").filter({ hasText: "revision 4" })).toContainText("(edited)");

    const edited = page.locator("[data-own]").filter({ hasText: "revision 4" });
    await edited.getByRole("button", { name: /Actions for/ }).click();
    await page.getByRole("menuitem", { name: "Delete…" }).click();
    await expect(page.getByRole("button", { name: "Keep it" })).toBeFocused();
    await page.getByRole("button", { name: "Delete", exact: true }).click();
    await expect(page.locator("[data-channel-announcer]")).toHaveText("Message deleted.");
    await expect(scroller(page)).toBeFocused();

    const post = page.locator(`[data-message="${COMMUNITY_THREAD}"]`);
    await post.locator("[data-reaction='learned']").click();
    await expect(post.locator("[data-reaction='learned']")).toHaveAttribute("aria-pressed", "true");
  });
});

test.describe("touch", () => {
  test.skip(Boolean(process.env.PLAYWRIGHT_BASE_URL), "The harness exists only in astro dev.");
  test.use({ hasTouch: true, isMobile: true, viewport: PHONE });

  test("Enter adds a line instead of sending, and the send button sends", async ({ page }) => {
    await open(page, harness());
    const box = composer(page);
    await box.tap();
    await box.pressSequentially("First line");
    await page.keyboard.press("Enter");
    await box.pressSequentially("second line");
    await expect(box).toHaveValue("First line\nsecond line");
    await expect(box).toHaveAttribute("enterkeyhint", "enter");
    await page.getByRole("button", { name: "Send message" }).tap();
    await expect(page.locator("[data-own]").filter({ hasText: "second line" })).toBeVisible();
  });

  test("touch targets are at least 44px", async ({ page }) => {
    await open(page, harness({ channel: "cohort-04" }));
    const small = await page.evaluate(() =>
      [...document.querySelectorAll<HTMLElement>(".channel-view a, .channel-view button")]
        .filter((el) => el.offsetParent !== null && el.getAttribute("tabindex") !== "-1")
        .map((el) => {
          const box = el.getBoundingClientRect();
          const extra = getComputedStyle(el, "::before").content !== "none" ? 12 : 0;
          return { name: el.getAttribute("aria-label") ?? el.textContent?.trim(), w: box.width + extra, h: box.height + extra };
        })
        .filter(({ w, h }) => Math.min(w, h) < 44 - 0.5),
    );
    expect(small).toEqual([]);
  });
});

test.describe("reduced motion", () => {
  test.skip(Boolean(process.env.PLAYWRIGHT_BASE_URL), "The harness exists only in astro dev.");
  test.use({ reducedMotion: "reduce", viewport: PHONE });

  test("threads and new messages arrive without movement", async ({ page }) => {
    await open(page, harness({ channel: "cohort-04" }));
    await arrive(page, 1);
    await expect(page.locator("[data-arrived]")).toHaveCount(1);
    await expect(page.locator("[data-arrived]")).toHaveCSS("animation-name", "none");
    await page.locator(`[data-thread-trigger="${COHORT_THREAD}"]`).click();
    await expect(page.locator("[data-thread-rail]")).toHaveCSS("animation-name", "none");
  });
});

test.describe("motion", () => {
  test.skip(Boolean(process.env.PLAYWRIGHT_BASE_URL), "The harness exists only in astro dev.");
  test.use({ reducedMotion: "no-preference", viewport: PHONE });

  test("a new message rises into place and the thread sheet slides in, then both rest", async ({ page }) => {
    await open(page, harness({ channel: "cohort-04" }));
    await arrive(page, 1);
    await expect(page.locator("[data-arrived]")).toHaveCSS("animation-name", "channel-arrive");
    await page.locator(`[data-thread-trigger="${COHORT_THREAD}"]`).click();
    const rail = page.locator("[data-thread-rail]");
    await expect(rail).toHaveCSS("animation-name", "channel-rail-in");
    await expect.poll(() => rail.evaluate((el) => el.getAnimations().every((a) => a.playState === "finished"))).toBe(true);
    await expect(rail).toHaveCSS("opacity", "1");
  });
});
