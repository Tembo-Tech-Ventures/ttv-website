import { createHash } from "node:crypto";
import { expect, test, type Browser, type Page, type TestInfo } from "@playwright/test";

/**
 * The browser contract for the attention and search overlays (U-1.3).
 *
 * Against `astro dev`, the DEV-only harness `/dev/platform-overlays` renders
 * SpacesLayout with the real overlays answering from fixtures, in scenarios a
 * real network produces (slow, failing then recovering, expired session, flag
 * off, empty, long, new arrivals). Unit tests cover the logic; this covers what
 * only a browser can: dialogs, focus, the keyboard, layout from 320 to 1440 px,
 * axe, reduced motion, and the page without JavaScript.
 *
 * Against a deployed preview it checks the real thing: the harness is absent,
 * `/dashboard/attention` follows the `spaces` flag, and a signed-in student's
 * attention page and search answer from the real APIs without an error state.
 */
const HARNESS = "/dev/platform-overlays";
const WIDE = 1024;
const AXE_URL = "https://cdn.jsdelivr.net/npm/axe-core@4.10.3/axe.min.js";
const AXE_SHA384 = "17w4i/EfU4m8vRTTBQs69gAb/fjBpQi0/OOcQTspZXbRlDA0OcGoZX3ZUxQpgTYL";

function harness(params: Record<string, string> = {}) {
  return `${HARNESS}?${new URLSearchParams({ persona: "wanjiku", space: "community", ...params })}`;
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

const wide = (page: Page) => (page.viewportSize()?.width ?? 0) >= WIDE;
const bell = (page: Page) => page.getByRole("button", { name: /^Attention/ });
const panel = (page: Page) => page.getByRole("dialog", { name: "Needs your attention" });
const search = (page: Page) => page.getByRole("dialog", { name: "Search everything" });
const box = (page: Page) => page.getByRole("combobox", { name: "Search people, projects and your sessions" });

async function runAxe(page: Page, testInfo: TestInfo, name: string) {
  const source = Buffer.from(await (await fetch(AXE_URL)).arrayBuffer());
  expect(createHash("sha384").update(source).digest("base64")).toBe(AXE_SHA384);
  if (!(await page.evaluate(() => "axe" in window))) await page.addScriptTag({ content: source.toString("utf8") });
  const result = await page.evaluate(async () => {
    type Run = { violations: { id: string; nodes: { target: string[] }[] }[]; incomplete: { id: string; nodes: unknown[] }[] };
    const { axe } = window as unknown as { axe: { run: (context: unknown, options: unknown) => Promise<Run> } };
    const run = await axe.run(
      { exclude: [["astro-dev-toolbar"]] },
      { runOnly: { type: "tag", values: ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"] } },
    );
    return {
      violations: run.violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(" ")).slice(0, 3).join(", ")}`),
      incomplete: run.incomplete.map((v) => `${v.id} × ${v.nodes.length}`),
    };
  });
  await testInfo.attach(`axe-incomplete-${name}`, { body: result.incomplete.join("\n") || "none", contentType: "text/plain" });
  expect(result.violations, name).toEqual([]);
}

/** Nothing scrolls sideways, and every visible box of `selector` stays inside the viewport. */
async function expectContained(page: Page, selector: string) {
  const report = await page.evaluate((sel) => {
    const width = document.documentElement.clientWidth;
    const outside = Array.from(document.querySelectorAll<HTMLElement>(sel))
      .flatMap((root) => [root, ...Array.from(root.querySelectorAll<HTMLElement>("*"))])
      .filter((element) => element.checkVisibility() && !element.closest(".sr-only, .search-scopes, .attention-filters"))
      .map((element) => ({ element, rect: element.getBoundingClientRect() }))
      .filter(({ rect }) => rect.width > 0 && (rect.left < -0.5 || rect.right > width + 0.5))
      .map(({ element, rect }) => `${element.tagName.toLowerCase()}.${element.className} ${Math.round(rect.left)}–${Math.round(rect.right)}`);
    return { overflow: document.documentElement.scrollWidth - width, outside: outside.slice(0, 5) };
  }, selector);
  expect(report.overflow, "page scrolls sideways").toBeLessThanOrEqual(0);
  expect(report.outside, "boxes outside the viewport").toEqual([]);
}

/** Collects every announcement either overlay makes, in order: each is a fresh node in a live region. */
async function recordAnnouncements(page: Page) {
  await page.evaluate(() => {
    const log: string[] = ((window as unknown as { __said: string[] }).__said = []);
    for (const region of document.querySelectorAll("[data-live-regions] output, [data-live-regions] [role=alert]")) {
      new MutationObserver((records) => {
        for (const record of records) for (const node of record.addedNodes) if (node.textContent?.trim()) log.push(node.textContent.trim());
      }).observe(region, { childList: true });
    }
  });
  return () => page.evaluate(() => (window as unknown as { __said: string[] }).__said);
}

test.describe("on a deployed build", () => {
  test.skip(!process.env.PLAYWRIGHT_BASE_URL, "Only deployed builds prove the harness is absent.");

  test("the overlays harness does not exist", async ({ page }) => {
    expect((await page.goto(harness()))?.status()).toBe(404);
  });

  test("the attention page follows the spaces flag for the delivery identity", async ({ browser, baseURL }) => {
    const token = process.env.PLAYWRIGHT_AGENT_TOKEN;
    test.skip(!token, "An authenticated delivery identity is required.");
    const context = await browser.newContext({ baseURL, extraHTTPHeaders: { Authorization: `Bearer ${token}` } });
    try {
      // Through the page, not a direct API call: the credential stays in the browser context.
      const page = await context.newPage();
      const me = (await page.goto("/api/platform/me"))!;
      const response = await page.goto("/dashboard/attention");
      if (me.status() !== 200) {
        // Flag off, or a token: the page does not exist for them.
        expect(response?.status()).toBe(404);
        return;
      }
      expect(response?.status()).toBe(200);
      await expect(page.getByRole("heading", { level: 1, name: "Needs your attention" })).toBeAttached();
    } finally {
      await context.close();
    }
  });

  test("a signed-in student's attention and search answer from the real APIs", async ({ browser, baseURL }) => {
    const token = process.env.PLAYWRIGHT_ACCEPTED_STUDENT_TOKEN;
    test.skip(!token, "Isolated previews provide an accepted-student persona.");
    const context = await browser.newContext({ baseURL, extraHTTPHeaders: { Authorization: `Bearer ${token}` } });
    try {
      const page = await context.newPage();
      const me = (await page.goto("/api/platform/me"))!;
      test.skip(me.status() !== 200, "The spaces flag is off for this deployment.");
      const failures: string[] = [];
      page.on("response", (response) => {
        if (/\/api\/(attention|search)/.test(response.url()) && response.status() >= 400) failures.push(`${response.status()} ${response.url()}`);
      });
      await page.goto("/dashboard/attention");
      await expect(page.locator("astro-island[ssr]")).toHaveCount(0);
      await expect(page.locator("[data-attention-loading]")).toHaveCount(0);
      await expect(page.locator("[data-attention-problem]")).toHaveCount(0);
      await expect(page.locator("[data-attention-item], [data-attention-empty]").first()).toBeVisible();

      await page.getByRole("button", { name: "Search everything" }).click();
      await page.getByRole("combobox").fill("a");
      await page.getByRole("combobox").fill("session");
      await expect(page.locator('[data-search-status="ready"]')).toBeAttached({ timeout: 15_000 });
      await expect(page.locator("[data-search-problem]")).toHaveCount(0);
      expect(failures).toEqual([]);
    } finally {
      await context.close();
    }
  });
});

test.describe("the overlays harness", () => {
  test.skip(Boolean(process.env.PLAYWRIGHT_BASE_URL), "The harness is dev-only and unavailable on deployed environments.");

  test.describe("attention", () => {
    test("the bell opens the panel on wide screens and the page on phones", async ({ page }) => {
      await open(page, harness());
      if (!wide(page)) {
        await page.route("**/dashboard/attention", (route) => route.fulfill({ status: 200, body: "attention page" }));
        await bell(page).click();
        await expect(page).toHaveURL(/\/dashboard\/attention$/);
        return;
      }
      await bell(page).click();
      await expect(panel(page)).toBeVisible();
      await expect(page.locator('[data-attention-filter="all"]')).toBeFocused();
      await expect(panel(page).locator("[data-attention-item]")).toHaveCount(6);
      await expect(panel(page).getByRole("heading", { level: 3 })).toHaveText(["New", "Earlier"]);
      // The sheet hangs from the bell and stays in the viewport.
      const [bellBox, panelBox] = [await bell(page).boundingBox(), await panel(page).boundingBox()];
      expect(Math.abs(bellBox!.x + bellBox!.width - (panelBox!.x + panelBox!.width))).toBeLessThan(2);
      expect(panelBox!.y).toBeGreaterThan(bellBox!.y + bellBox!.height);
      await expectContained(page, "[data-attention-panel]");
    });

    test("keyboard: Tab stays inside, Escape closes, focus returns to the bell", async ({ page }) => {
      await open(page, harness());
      test.skip(!wide(page), "The panel is the wide layout's.");
      await bell(page).focus();
      await page.keyboard.press("Enter");
      await expect(panel(page)).toBeVisible();
      for (let step = 0; step < 14; step++) {
        await page.keyboard.press("Tab");
        expect(await page.evaluate(() => Boolean(document.activeElement?.closest("[data-attention-panel]")))).toBe(true);
      }
      await page.keyboard.press("Escape");
      await expect(panel(page)).toBeHidden();
      await expect(bell(page)).toBeFocused();
    });

    test("a click on the dimmed page closes the panel", async ({ page }) => {
      await open(page, harness());
      test.skip(!wide(page), "The panel is the wide layout's.");
      await bell(page).click();
      await expect(panel(page)).toBeVisible();
      await page.mouse.click(120, 600);
      await expect(panel(page)).toBeHidden();
    });

    test("passes axe with the panel open and on the page, and fits 320 to 1440 px", async ({ page }, testInfo) => {
      await open(page, harness({ page: "attention" }));
      for (const width of [320, 390, 768, 1024, 1440]) {
        await page.setViewportSize({ width, height: 900 });
        await expectContained(page, "#spaces-main");
      }
      await runAxe(page, testInfo, "page");
      if (wide(page)) {
        await open(page, harness());
        await bell(page).click();
        await expect(panel(page).locator("[data-attention-item]").first()).toBeVisible();
        await runAxe(page, testInfo, "panel");
      }
    });

    test("the page shows its items without JavaScript, as links", async ({ browser }, testInfo) => {
      const context = await browser.newContext({ ...testInfo.project.use, javaScriptEnabled: false });
      const page = await context.newPage();
      await page.goto(harness({ page: "attention" }));
      await expect(page.locator("[data-attention-item]")).toHaveCount(6);
      await expect(page.locator("[data-attention-item] a").first()).toHaveAttribute("href", /\/dashboard\/community\/dm\//);
      await expect(page.locator("[data-attention-loading]")).toHaveCount(0);
      await context.close();
    });

    test("opening an item marks it read before following it", async ({ page }) => {
      await open(page, harness({ page: "attention" }));
      // Hold the destination, so the page that is leaving can still be read.
      let release = () => {};
      const held = new Promise<void>((resolve) => {
        release = resolve;
      });
      await page.route("**/dashboard/community/dm/**", async (route) => {
        await held;
        await route.fulfill({ status: 200, body: "conversation" });
      });
      await expect(page.locator("[data-attention-total]")).toHaveText("4 new");
      await page.locator("[data-attention-item] a").first().click();
      await expect(page.locator("[data-attention-total]")).toHaveText("3 new");
      release();
      await expect(page).toHaveURL(/\/dashboard\/community\/dm\//);
    });

    test("a mark that fails is rolled back, said once, and can be tried again", async ({ page }) => {
      await open(page, harness({ page: "attention", scenario: "readfail" }));
      const said = await recordAnnouncements(page);
      await page.getByRole("button", { name: "Mark all read" }).click();
      const failure = page.locator("[data-attention-failure]");
      await expect(failure).toContainText("Couldn't mark everything read.");
      await expect(page.locator("[data-attention-item][data-unread]")).toHaveCount(4);
      await failure.getByRole("button", { name: "Try again" }).click();
      await expect(page.locator("[data-attention-item][data-unread]")).toHaveCount(0);
      await expect(page.locator("[data-attention-total]")).toHaveText("You're all caught up.");
      await expect(failure).toHaveCount(0);
      await expect.poll(async () => (await said()).at(-1)).toBe("Marked read");
      expect((await said()).filter((text) => text.startsWith("Could not mark read"))).toHaveLength(1);
    });

    test("a slow load interrupted by marks recovers with an explicit retry, never an empty idle inbox", async ({ page }) => {
      await open(page, harness({ scenario: "slow" }));
      test.skip(!wide(page), "Reopening the panel refreshes while marks run.");
      await bell(page).click();
      await expect(panel(page).locator("[data-attention-item]")).toHaveCount(6, { timeout: 10_000 });
      await page.keyboard.press("Escape");
      await bell(page).click(); // A slow refresh starts…
      await panel(page).getByRole("button", { name: "Mark all read" }).click(); // …and writes land during it.
      await expect(panel(page).locator("[data-attention-loading]")).toHaveCount(0, { timeout: 15_000 });
      // Either the page settled, or it says what happened and offers a retry; it is never silently empty.
      await expect(panel(page).locator("[data-attention-item], [data-attention-problem]").first()).toBeVisible({ timeout: 15_000 });
      const problem = panel(page).locator("[data-attention-problem]");
      if (await problem.count()) {
        await problem.getByRole("button", { name: "Try again" }).click();
        await expect(panel(page).locator("[data-attention-item]")).toHaveCount(6, { timeout: 15_000 });
      }
      await expect(panel(page).locator("[data-attention-item][data-unread]")).toHaveCount(0);
    });

    test("states are truthful: failing then recovering, signed out, off, empty, long", async ({ page }) => {
      await open(page, harness({ page: "attention", scenario: "error" }));
      await expect(page.locator('[data-attention-problem="failed"]')).toContainText("Couldn't load attention items.");
      await page.getByRole("button", { name: "Try again" }).click();
      await expect(page.locator("[data-attention-item]")).toHaveCount(6);

      await open(page, harness({ page: "attention", scenario: "expired" }));
      await expect(page.locator('[data-attention-problem="signed-out"]').getByRole("link", { name: "Sign in again" })).toHaveAttribute(
        "href",
        /^\/auth\/login\?next=%2Fdev%2Fplatform-overlays/,
      );
      await expect(page.locator("[data-attention-empty]")).toHaveCount(0);

      await open(page, harness({ page: "attention", scenario: "off" }));
      await expect(page.locator('[data-attention-problem="unavailable"]')).toBeVisible();

      await open(page, harness({ page: "attention", scenario: "empty" }));
      await expect(page.locator("[data-attention-empty]")).toHaveText("Nothing needs you right now.");
      await page.locator('[data-attention-filter="requests"]').click();
      await expect(page.locator("[data-attention-empty]")).toHaveText("No mentoring requests yet.");

      await open(page, harness({ page: "attention", scenario: "many" }));
      await expect(page.locator("[data-attention-item]")).toHaveCount(30);
      await page.getByRole("button", { name: "Show older" }).click();
      await expect(page.locator("[data-attention-item]")).toHaveCount(46);
      await expect(page.getByRole("button", { name: "Show older" })).toHaveCount(0);
    });

    test("new attention is announced once and reaches the bell and tabs", async ({ page }) => {
      await open(page, harness({ scenario: "arrivals" }));
      const said = await recordAnnouncements(page);
      await expect(bell(page)).toHaveAccessibleName("Attention, 4 waiting");
      // Focus refreshes counts at once, as returning to the tab does.
      await page.evaluate(() => window.dispatchEvent(new Event("focus")));
      await page.evaluate(() => window.dispatchEvent(new Event("focus")));
      await expect(bell(page)).toHaveAccessibleName("Attention, 5 waiting", { timeout: 10_000 });
      await page.waitForTimeout(1_500);
      expect((await said()).filter((text) => text === "1 new attention item")).toHaveLength(1);
      // One live region pair per overlay: never two voices for one event.
      await expect(page.locator('[data-live-regions="attention"]')).toHaveCount(1);
    });

    test("with reduced motion the panel simply appears", async ({ page }) => {
      await page.emulateMedia({ reducedMotion: "reduce" });
      await open(page, harness());
      test.skip(!wide(page), "The panel is the wide layout's.");
      await bell(page).click();
      const transition = await panel(page).evaluate((element) => getComputedStyle(element).transitionDuration);
      expect(transition.split(",").every((value) => Number.parseFloat(value) === 0)).toBe(true);
    });
  });

  test.describe("search", () => {
    async function openSearch(page: Page) {
      if (wide(page)) await page.keyboard.press("Control+k");
      else await page.getByRole("button", { name: "Search everything" }).click();
      await expect(search(page)).toBeVisible();
      await expect(box(page)).toBeFocused();
    }

    test("Ctrl K or the button opens it; arrows choose, Enter opens; Escape gives focus back", async ({ page }, testInfo) => {
      await open(page, harness());
      const trigger = page.getByRole("button", { name: "Search everything" });
      await trigger.focus();
      await openSearch(page);
      await box(page).fill("retry webhook");
      await expect(page.locator('[role="option"]')).toHaveCount(3);
      await expect(search(page).locator('[role="listbox"] [role="group"]')).toHaveText([/People/, /Projects/, /Moments in your sessions/]);
      await expectContained(page, "[data-search-overlay]");
      await runAxe(page, testInfo, "search-results");

      await page.keyboard.press("ArrowDown");
      await page.keyboard.press("ArrowDown");
      await expect(page.locator('[role="option"]').nth(1)).toHaveAttribute("aria-selected", "true");
      await expect(box(page)).toHaveAttribute("aria-activedescendant", (await page.locator('[role="option"]').nth(1).getAttribute("id"))!);
      await page.keyboard.press("Escape");
      await expect(search(page)).toBeHidden();
      await expect(trigger).toBeFocused();

      await openSearch(page);
      await expect(box(page)).toHaveValue("retry webhook"); // Kept in memory while the page is open, never stored.
      await expect(page.locator('[role="option"]')).toHaveCount(3);
      await page.route("**/community/mentors", (route) => route.fulfill({ status: 200, body: "mentors" }));
      await page.keyboard.press("ArrowDown");
      await page.keyboard.press("Enter");
      await expect(page).toHaveURL(/\/dashboard\/community\/mentors$/);
    });

    test("waits for typing, shows progress, and an older answer never replaces a newer one", async ({ page }) => {
      await open(page, harness({ scenario: "slow" }));
      await openSearch(page);
      await box(page).pressSequentially("retry", { delay: 30 });
      await expect(page.locator("[data-search-loading]")).toContainText("Searching for “retry”");
      await expect(page.locator(".search-overlay__results")).toHaveAttribute("aria-busy", "true");
      await page.waitForTimeout(400); // "retry" is in flight.
      await box(page).fill("nothing at all");
      await expect(page.locator("[data-search-empty]")).toContainText("nothing at all", { timeout: 10_000 });
      await page.waitForTimeout(1_000);
      await expect(page.locator('[role="option"]')).toHaveCount(0);
    });

    test("failures say so and recover; a signed-out person is sent to sign in", async ({ page }) => {
      await open(page, harness({ scenario: "error" }));
      await openSearch(page);
      await box(page).fill("webhook");
      await expect(page.locator("[data-search-problem]")).toContainText("Search didn't work this time.");
      await search(page).getByRole("button", { name: "Try again" }).click();
      await expect(page.locator('[role="option"]')).toHaveCount(3);

      await open(page, harness({ scenario: "expired" }));
      await openSearch(page);
      await box(page).fill("webhook");
      await expect(page.locator("[data-search-problem]").getByRole("link", { name: "Sign in again" })).toBeVisible();
    });

    test("Ask Tembo opens the Ask page with the question ready, unsent; only for cohort members", async ({ page }) => {
      await open(page, harness());
      await openSearch(page);
      await box(page).fill("retry webhook");
      await page.route("**/dashboard/ask", (route) => route.fulfill({ status: 200, body: "ask" }));
      const posts: string[] = [];
      page.on("request", (request) => {
        if (request.method() !== "GET") posts.push(request.url());
      });
      await search(page).getByRole("button", { name: /Ask Tembo about “retry webhook”/ }).click();
      await expect(page).toHaveURL(/\/dashboard\/ask#ask-tembo=retry%20webhook$/);
      expect(posts).toEqual([]);

      await open(page, harness({ persona: "lucy" }));
      await openSearch(page);
      await box(page).fill("retry webhook");
      await expect(page.locator('[role="option"]').first()).toBeVisible();
      await expect(search(page).getByRole("button", { name: /Ask Tembo/ })).toHaveCount(0);
    });

    test("recent searches belong to one person and go on sign-out", async ({ page }) => {
      await open(page, harness());
      await openSearch(page);
      await box(page).fill("webhook");
      await expect(page.locator('[role="option"]')).toHaveCount(3);
      await page.route("**/community/mentors", (route) => route.fulfill({ status: 200, body: "mentors" }));
      await page.keyboard.press("Enter");
      await expect(page).toHaveURL(/mentors$/);

      await open(page, harness());
      await openSearch(page);
      await expect(page.locator("[data-search-recent]")).toContainText("webhook");
      await page.keyboard.press("Escape");

      // Someone else on this browser sees nothing of it.
      await open(page, harness({ persona: "lucy" }));
      await openSearch(page);
      await expect(page.locator("[data-search-recent]")).toHaveCount(0);
      await page.keyboard.press("Escape");

      await open(page, harness());
      await openSearch(page);
      await expect(page.locator("[data-search-recent]")).toHaveCount(0);
      expect(await page.evaluate(() => Object.keys(localStorage).filter((key) => key.startsWith("ttv:search-recent")))).toEqual([]);
    });

    test("signing out from the account menu removes stored searches", async ({ page }) => {
      await open(page, harness());
      await page.evaluate(() => localStorage.setItem("ttv:search-recent:v1:somebody", '["x"]'));
      await page.locator("details.spaces-account > summary").click();
      await page.locator("[data-shell-sign-out]").click();
      expect(await page.evaluate(() => Object.keys(localStorage).filter((key) => key.startsWith("ttv:search-recent")))).toEqual([]);
    });

    test("fits every width from 320 px, with the keyboard hint only where there are keys", async ({ page }) => {
      await open(page, harness());
      await openSearch(page);
      await box(page).fill("retry webhook");
      await expect(page.locator('[role="option"]')).toHaveCount(3);
      for (const width of [320, 390, 768, 1440]) {
        await page.setViewportSize({ width, height: 844 });
        await expectContained(page, "[data-search-overlay]");
      }
    });
  });
});

/** Saved by `npx playwright test e2e/platform-overlays.spec.ts --grep evidence` for the PR. */
test.describe("evidence", () => {
  test.skip(Boolean(process.env.PLAYWRIGHT_BASE_URL) || !process.env.OVERLAY_EVIDENCE, "Screenshots for review, on request.");

  async function shot(browser: Browser, width: number, height: number, path: string, act: (page: Page) => Promise<void>, mobile = false) {
    const context = await browser.newContext({ viewport: { width, height }, deviceScaleFactor: 2, isMobile: mobile, hasTouch: mobile });
    const page = await context.newPage();
    await act(page);
    await page.waitForTimeout(400);
    await page.screenshot({ path: `test-results/evidence/platform-overlays/${path}` });
    await context.close();
  }

  test("captures desktop and phone screens", async ({ browser }) => {
    await shot(browser, 1440, 900, "attention-panel-1440.png", async (page) => {
      await open(page, harness());
      await bell(page).click();
      await expect(panel(page).locator("[data-attention-item]")).toHaveCount(6);
    });
    await shot(browser, 1440, 900, "search-1440.png", async (page) => {
      await open(page, harness({ space: "cohort" }));
      await page.keyboard.press("Control+k");
      await box(page).fill("retry webhook");
      await expect(page.locator('[role="option"]')).toHaveCount(3);
      await page.keyboard.press("ArrowDown");
    });
    await shot(browser, 1440, 900, "attention-page-1440.png", async (page) => open(page, harness({ page: "attention" })));
    for (const width of [390, 320]) {
      await shot(browser, width, 844, `attention-page-${width}.png`, async (page) => open(page, harness({ page: "attention" })), true);
      await shot(
        browser,
        width,
        844,
        `search-${width}.png`,
        async (page) => {
          await open(page, harness());
          await page.getByRole("button", { name: "Search everything" }).click();
          await box(page).fill("retry webhook");
          await expect(page.locator('[role="option"]')).toHaveCount(3);
        },
        true,
      );
    }
    for (const scenario of ["readfail", "expired", "empty", "error"]) {
      await shot(browser, 390, 844, `attention-${scenario}-390.png`, async (page) => {
        await open(page, harness({ page: "attention", scenario }));
        if (scenario === "readfail") {
          await page.getByRole("button", { name: "Mark all read" }).click();
          await expect(page.locator("[data-attention-failure]")).toBeVisible();
        }
      }, true);
    }
  });
});
