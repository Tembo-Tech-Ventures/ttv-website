import { mkdirSync } from "node:fs";
import { expect, test, type Locator, type Page } from "@playwright/test";
import { runAxe } from "./platform-axe";

/**
 * U-2.4: the admin moderation queue (screens/08) on its DEV-only harness `/dev/platform-moderation`,
 * which renders the real queue in the real admin shell over fixture cases in B-2.5's shape:
 * - the layout at 1440 and 390, axe A/AA clean, 44px controls, no sideways scroll;
 * - keyboard order through a case: the reason, then each decision;
 * - hide, restore and keep, with JavaScript (no page load) and without (form posts), each needing a reason;
 * - a refused decision (409) and an unreachable server never look recorded: the case stays, the
 *   reason stays, and focus lands on why nothing changed.
 * The real page's access and decisions against the backend are in platform-moderation-staff.spec.ts.
 */

const HARNESS = "/dev/platform-moderation";
const EVIDENCE_DIR = "test-results/evidence/platform-moderation";
mkdirSync(EVIDENCE_DIR, { recursive: true });

// The fixture cases: one case per message, so a case's id is its message's id.
const PETER = "s00000000000000000000421"; // flagged by Tembo: contact details
const COLLINS = "s00000000000000000000422"; // reported by two members
const DENNIS = "s00000000000000000000423"; // hidden by a mentor, review requested
const KEVIN = "harness-moderation-reply"; // a reply in a cohort thread

test.describe("on a deployed build", () => {
  test.skip(!process.env.PLAYWRIGHT_BASE_URL, "Only deployed builds prove the harness is absent.");

  test("the moderation harness does not exist", async ({ page }) => {
    const response = await page.goto(HARNESS);
    expect(response?.status()).toBe(404);
  });
});

test.describe("admin moderation queue", () => {
  test.skip(Boolean(process.env.PLAYWRIGHT_BASE_URL), "The harness is dev-only and intentionally unavailable on deployed environments.");
  test.use({ reducedMotion: "reduce" });

  test.beforeEach(async ({ page }, testInfo) => {
    if (testInfo.project.name === "mobile-chromium") await page.setViewportSize({ width: 390, height: 844 });
    else await page.setViewportSize({ width: 1440, height: 900 });
  });

  /** A fresh queue for this test alone, so parallel browsers never share decisions. */
  function runFor(extra = "") {
    const info = test.info();
    const run = `${info.project.name}-${info.testId}`.replace(/[^\w-]/g, "").slice(0, 40);
    return `${HARNESS}?run=${run}${extra}`;
  }

  async function open(page: Page, path: string) {
    const response = await page.goto(path);
    expect(response?.status(), path).toBe(200);
    if (await page.evaluate(() => document.querySelector("astro-dev-toolbar") !== null)) {
      await page.addStyleTag({ content: "astro-dev-toolbar { display: none !important; }" });
    }
    await expect(page.locator("astro-island[ssr]")).toHaveCount(0);
    await page.evaluate(() => document.fonts.ready);
  }

  const card = (page: Page, id: string) => page.locator(`[data-moderation-case="${id}"]`);
  const reason = (scope: Locator) => scope.getByRole("textbox", { name: "Reason" });
  const evidence = (name: string) => `${EVIDENCE_DIR}/${test.info().project.name}-${name}.png`;

  /** Pressed from the keyboard: the site's feedback pill can sit over the last row at 1440 x 900. */
  async function press(button: Locator) {
    await button.focus();
    await button.press("Enter");
  }

  test("lays the queue out as screens/08 does, clean under axe", async ({ page }, testInfo) => {
    await open(page, runFor("&reset"));
    await expect(page.getByRole("heading", { level: 2, name: "Moderation" })).toBeVisible();
    await expect(page.getByText("Everything else, contact details included, stays visible until a person decides.")).toBeVisible();
    // Only a hide's reason reaches the author, and the form says so.
    await expect(card(page, PETER).getByRole("textbox", { name: "Reason" }))
      .toHaveAccessibleDescription("Kept with your decision. If you hide the message, its author sees this reason.");
    await expect(page.getByRole("link", { name: /^Needs a decision\s+4 waiting$/ })).toHaveAttribute("aria-current", "page");
    await expect(page.locator("[data-moderation-list=PENDING] > li")).toHaveCount(4);

    const peter = card(page, PETER);
    await expect(peter.locator("[data-chip]")).toHaveText("Flagged by Tembo");
    await expect(peter.locator("[data-moderation-context]")).toHaveText("Community · #opportunities · still visible");
    await expect(peter.getByRole("heading", { level: 3, name: "Peter Njoroge" })).toBeVisible();
    await expect(peter.locator("[data-moderation-reasons]")).toHaveText("Contact details");
    await expect(peter.getByRole("link", { name: "Open in #opportunities" })).toHaveAttribute("href", `/dashboard/community/c/opportunities?message=${PETER}`);
    await expect(peter.getByRole("button", { name: "Fine as is: Peter Njoroge's message in #opportunities" })).toBeVisible();

    await expect(card(page, COLLINS).locator("[data-chip]")).toHaveText("Reported by 2 members");
    const dennis = card(page, DENNIS);
    await expect(dennis.locator("[data-chip]")).toHaveText("Hidden by David Kamau");
    await expect(dennis.locator("[data-moderation-context]")).toContainText("hidden from members");
    await expect(dennis.locator("[data-moderation-review]")).toContainText("Dennis asked for a review");
    await expect(dennis.getByRole("button", { name: /^Keep hidden:/ })).toBeVisible();
    await expect(dennis.getByRole("button", { name: /^Restore:/ })).toBeVisible();
    await expect(dennis.getByRole("button", { name: /^Fine as is:/ })).toHaveCount(0);
    // Earlier text, kept as evidence, opens on request.
    await dennis.locator("[data-moderation-evidence] summary").click();
    await expect(dennis.locator("[data-moderation-evidence]")).toContainText("Before an edit");
    await expect(dennis.locator("[data-moderation-evidence]")).toContainText("not worth anyone's time");
    await expect(card(page, KEVIN).getByRole("link", { name: "Open the thread in #cohort-04" }))
      .toHaveAttribute("href", new RegExp(`^/dashboard/cohort/c/cohort-04\\?thread=\\w+&message=${KEVIN}$`));

    // The sidebar names the queue and counts what waits. Phones open it as a drawer.
    if (testInfo.project.name === "chromium") {
      await expect(page.locator('aside a[href="/admin/moderation"]')).toHaveAccessibleName(/^Moderation\s+4 waiting$/);
    }
    // Every control is at least 44px tall, and nothing scrolls sideways.
    for (const control of await page.locator("main button, main textarea, main summary, main [data-moderation-root] nav a").all()) {
      if (!(await control.isVisible())) continue;
      expect((await control.boundingBox())?.height ?? 0, await control.evaluate((node) => node.outerHTML.slice(0, 80))).toBeGreaterThanOrEqual(44);
    }
    expect(await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)).toBe(0);

    await runAxe(page, testInfo, "moderation-pending", { include: ["main"] });
    await page.screenshot({ path: evidence("pending"), fullPage: true });
  });

  test("reaches every decision from the keyboard, in reading order", async ({ page }) => {
    await open(page, runFor("&reset"));
    const peter = card(page, PETER);
    await page.getByRole("link", { name: /^Needs a decision/ }).focus();
    await page.keyboard.press("Tab");
    await expect(page.getByRole("link", { name: "Decided" })).toBeFocused();
    await page.keyboard.press("Tab");
    await expect(peter.getByRole("link", { name: "Peter Njoroge" })).toBeFocused();
    await page.keyboard.press("Tab");
    await expect(peter.getByRole("link", { name: "Open in #opportunities" })).toBeFocused();
    await page.keyboard.press("Tab");
    await expect(reason(peter)).toBeFocused();
    await page.keyboard.press("Tab");
    await expect(peter.getByRole("button", { name: /^Fine as is/ })).toBeFocused();
    await page.keyboard.press("Tab");
    await expect(peter.getByRole("button", { name: /^Hide/ })).toBeFocused();
  });

  test("hides, keeps and restores without a page load, each with its reason", async ({ page }, testInfo) => {
    await open(page, runFor("&reset"));
    let loads = 0;
    page.on("load", () => { loads += 1; });

    // A decision needs a reason: the browser holds the form until there is one.
    const collins = card(page, COLLINS);
    await press(collins.getByRole("button", { name: /^Hide/ }));
    await expect(reason(collins)).toBeFocused();
    await expect(page.locator("[data-moderation-notice]")).toHaveCount(0);

    await reason(collins).fill("Promotion unrelated to the community.");
    await press(collins.getByRole("button", { name: /^Hide/ }));
    const notice = page.locator("[data-moderation-notice]");
    await expect(notice).toHaveText(/^Hidden\. Members no longer see the message\./);
    await expect(notice).toBeFocused();
    await expect(card(page, COLLINS)).toHaveCount(0);
    await expect(page.getByRole("link", { name: /^Needs a decision\s+3 waiting$/ })).toBeVisible();
    await page.screenshot({ path: evidence("hidden-notice") });

    await reason(card(page, PETER)).fill("An email in a jobs post is fine.");
    await press(card(page, PETER).getByRole("button", { name: /^Fine as is/ }));
    await expect(notice).toHaveText(/^Kept as is\./);

    await reason(card(page, DENNIS)).fill("Reworded critique of a common bug, not of a person.");
    await press(card(page, DENNIS).getByRole("button", { name: /^Restore/ }));
    await expect(notice).toHaveText(/^Restored\./);
    expect(loads, "decisions swap the queue in place").toBe(0);

    // Decided, newest decisions with who decided and why.
    await notice.getByRole("link", { name: "See decided cases" }).click();
    await expect(page.getByRole("link", { name: "Decided" })).toHaveAttribute("aria-current", "page");
    const decided = (id: string) => card(page, id).locator("[data-moderation-decision]");
    await expect(decided(COLLINS)).toContainText("Hidden by Amina Hassan");
    await expect(decided(COLLINS)).toContainText("Promotion unrelated to the community.");
    await expect(decided(PETER)).toContainText("Kept as is by Amina Hassan");
    await expect(decided(DENNIS)).toContainText("Restored by Amina Hassan");
    await expect(card(page, COLLINS).locator("[data-moderation-context]")).toContainText("hidden from members");
    // A decided case can be reversed, with a reason.
    await card(page, COLLINS).locator("[data-moderation-change] summary").click();
    await expect(card(page, COLLINS).getByRole("button", { name: /^Restore/ })).toBeVisible();

    await runAxe(page, testInfo, "moderation-decided", { include: ["main"] });
    await page.screenshot({ path: evidence("decided"), fullPage: true });
  });

  test("never shows a refused decision as made", async ({ page }, testInfo) => {
    await open(page, runFor("&reset&fail=409"));
    const peter = card(page, PETER);
    await reason(peter).fill("Looks like a scam.");
    await press(peter.getByRole("button", { name: /^Hide/ }));

    const error = card(page, PETER).locator("[data-moderation-error]");
    await expect(error).toHaveText("Nothing changed. An admin has already reviewed this message. The case below is as it stands now.");
    await expect(error).toBeFocused();
    await expect(reason(card(page, PETER))).toHaveValue("Looks like a scam.");
    await expect(reason(card(page, PETER))).toHaveAttribute("aria-invalid", "true");
    await expect(page.locator("[data-moderation-notice]")).toHaveCount(0);
    await expect(card(page, PETER)).toHaveAttribute("data-state", "PENDING");
    await expect(page.getByRole("link", { name: /^Needs a decision\s+4 waiting$/ })).toBeVisible();
    await runAxe(page, testInfo, "moderation-refused", { include: ["main"] });
    await page.screenshot({ path: evidence("refused") });
  });

  test("says nothing changed when TTV cannot be reached", async ({ page }) => {
    await open(page, runFor("&reset"));
    await page.route((url) => url.pathname === HARNESS, (route) =>
      route.request().method() === "POST" ? route.abort("internetdisconnected") : route.continue());
    const peter = card(page, PETER);
    await reason(peter).fill("An email in a jobs post is fine.");
    await press(peter.getByRole("button", { name: /^Fine as is/ }));
    const error = peter.locator("[data-moderation-error]");
    await expect(error).toHaveText("Nothing changed. TTV could not be reached. Check your connection and try again.");
    await expect(error).toBeFocused();
    await expect(page.locator("[data-moderation-notice]")).toHaveCount(0);
    await expect(peter.getByRole("button", { name: /^Fine as is/ })).not.toHaveAttribute("aria-disabled", "true");

    // Once the connection is back, the same press goes through.
    await page.unrouteAll();
    await press(peter.getByRole("button", { name: /^Fine as is/ }));
    await expect(page.locator("[data-moderation-notice]")).toHaveText(/^Kept as is\./);
  });

  test.describe("without JavaScript", () => {
    test.use({ javaScriptEnabled: false });

    test("decides with a form post, and refuses with the reason kept", async ({ page }) => {
      await page.goto(runFor("&reset"));
      const peter = card(page, PETER);
      await reason(peter).fill("An email in a jobs post is fine.");
      await press(peter.getByRole("button", { name: /^Fine as is/ }));
      await expect(page).toHaveURL(/decided=keep/);
      await expect(page.locator("[data-moderation-notice]")).toHaveText(/^Kept as is\./);
      await expect(card(page, PETER)).toHaveCount(0);

      const refused = await page.goto(runFor("&fail=409"));
      expect(refused?.status()).toBe(200);
      const collins = card(page, COLLINS);
      await reason(collins).fill("Promotion.");
      const [response] = await Promise.all([
        page.waitForResponse((r) => r.request().method() === "POST"),
        press(collins.getByRole("button", { name: /^Hide/ })),
      ]);
      expect(response.status()).toBe(409);
      await expect(card(page, COLLINS).locator("[data-moderation-error]")).toHaveText(/^Nothing changed\./);
      await expect(reason(card(page, COLLINS))).toHaveValue("Promotion.");
      await expect(page.locator("[data-moderation-notice]")).toHaveCount(0);
    });
  });
});
