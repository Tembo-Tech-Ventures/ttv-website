import { expect, test, type Page } from "@playwright/test";
import { AXE_VERSION, axeRun, runAxe } from "./platform-axe";
import { installTextTracker, sampleText, textReport } from "./text-integrity";

/**
 * The browser contract for the spaces shell (U-1.1): SpacesLayout, rendered by
 * the DEV-only harness `/dev/platform-shell` for synthetic personas. Unit tests
 * cover the markup and state; this covers what only a browser can see: the
 * row and bottom bar at every width, the drawer's focus and inertness, the
 * account menu, the overlay triggers, the space-switch transition, axe, and
 * that the shell works without JavaScript.
 */
const HARNESS = "/dev/platform-shell";
const EVIDENCE_DIR = "test-results/evidence/platform-shell";
const WIDE = 1024;
const SWEEP = [320, 360, 390, 414, 600, 768, 820, 1023, 1024, 1100, 1180, 1280, 1366, 1440];
const SWEEP_PERSONAS = ["every", "amina", "joseph", "david", "wanjiku", "lucy"] as const;


const SPACES_BY_PERSONA = {
  wanjiku: ["Cohort", "Community", "Profile"],
  david: ["Cohort", "Community", "Mentoring", "Profile"],
  lucy: ["Community", "Profile"],
  joseph: ["Community", "Mentoring", "Discover", "Profile"],
  amina: ["Cohort", "Community", "Discover", "Admin", "Profile"],
  every: ["Cohort", "Community", "Mentoring", "Discover", "Admin", "Profile"],
} as const;

function harness(persona: string, space?: string, extra = "") {
  return `${HARNESS}?persona=${persona}${space ? `&space=${space}` : ""}${extra}`;
}

/** Chromium in the dev container cannot reach Google Fonts itself; Node can. */
async function routeFonts(page: Page) {
  await page.route(/fonts\.(googleapis|gstatic)\.com/, async (route) => {
    try {
      const response = await fetch(route.request().url());
      await route.fulfill({
        status: response.status,
        headers: Object.fromEntries(response.headers),
        body: Buffer.from(await response.arrayBuffer()),
      });
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

function wide(page: Page) {
  return (page.viewportSize()?.width ?? 0) >= WIDE;
}

/** The avatar's disclosure: Account, Feedback and Sign out. */
function accountMenu(page: Page) {
  const details = page.locator("details.spaces-account");
  return { summary: details.locator("> summary"), panel: details.locator(".spaces-account__panel") };
}

/** The space navigation a person sees at this width: tabs, or the bottom bar. */
function spacesNav(page: Page) {
  return wide(page) ? page.locator(".space-file__nav") : page.locator(".spaces-bottom");
}


test.describe("on a deployed build", () => {
  test.skip(!process.env.PLAYWRIGHT_BASE_URL, "Only deployed builds prove the harness is absent.");

  test("the shell harness does not exist", async ({ page }) => {
    const response = await page.goto(harness("wanjiku"));
    expect(response?.status()).toBe(404);
  });
});

test.describe("the spaces shell harness", () => {
  test.skip(Boolean(process.env.PLAYWRIGHT_BASE_URL), "The harness is dev-only and unavailable on deployed environments.");

  test("shows each person only their spaces, in order, with Profile last and their page current", async ({ page }) => {
    for (const [persona, expected] of Object.entries(SPACES_BY_PERSONA)) {
      await open(page, harness(persona));
      const nav = spacesNav(page);
      const labels = await nav.locator(wide(page) ? ".space-tab__label" : ".spaces-bottom__label").allTextContents();
      expect(labels, persona).toEqual([...expected]);
      await expect(nav.locator('[aria-current="page"]')).toHaveCount(1);
      await expect(nav.locator('[aria-current="page"]')).toContainText(expected[0]);
      // Exactly one space navigation is ever exposed.
      await expect(page.getByRole("navigation", { name: "Spaces" })).toHaveCount(1);
    }
  });

  test("passes axe at WCAG 2.2 A and AA, at rest, with the menu open and with the drawer open", async ({ page }, testInfo) => {
    await open(page, harness("david", "mentoring"));
    await runAxe(page, testInfo, "rest");

    await accountMenu(page).summary.click();
    await expect(accountMenu(page).panel).toBeVisible();
    await runAxe(page, testInfo, "menu");
    await page.keyboard.press("Escape");

    if (!wide(page)) {
      await page.getByRole("link", { name: "Open Mentoring menu" }).click();
      await expect(page.getByRole("dialog", { name: "Mentoring menu" })).toBeVisible();
      await runAxe(page, testInfo, "drawer");
    }
  });

  /*
   * QA1R-01: axe 4.14 turned label-content-name-mismatch on, and every space
   * page failed it. The brand read "TEMBOTech" to it, Search hid "Ctrl K" from
   * its name, and the avatar's name left out the initials it shows.
   */
  for (const width of [1280, 390]) {
    test(`names every shell control with the words it shows, for every person in every space, at ${width}px`, async ({ page }, testInfo) => {
      // About 35 harness pages, each hydrated and checked with axe: a long walk on a dev server.
      test.setTimeout(240_000);
      const people = { ...SPACES_BY_PERSONA, unbadged: ["Cohort", "Community", "Profile"], confirming: SPACES_BY_PERSONA.david };
      await page.setViewportSize({ width, height: width > WIDE ? 800 : 844 });
      for (const [persona, spaces] of Object.entries(people)) {
        for (const space of spaces) {
          await open(page, harness(persona, space.toLowerCase()));
          await runAxe(page, testInfo, `${persona}-${space}-${width}`);
        }
        await accountMenu(page).summary.click();
        await expect(accountMenu(page).panel).toBeVisible();
        await runAxe(page, testInfo, `${persona}-menu-${width}`);
      }
    });
  }

  test("runs an axe that catches the names QA-1 shipped with", async ({ page }) => {
    await open(page, harness("david", "mentoring"));
    // The #247 markup, as it was: no space between the mark's words, the shortcut left out of the name.
    await page.locator("#spaces-main").evaluate((main) => {
      main.insertAdjacentHTML(
        "afterbegin",
        `<div id="qa1r-01">
          <a id="old-brand" href="/" aria-label="Tembo Tech Ventures home" style="display:flex"><span aria-hidden="true">TEMBO</span><span aria-hidden="true">Tech · Ventures</span></a>
          <button id="old-search" type="button" aria-label="Search"><span>Search</span><kbd aria-hidden="true">Ctrl K</kbd></button>
        </div>`,
      );
    });
    const run = await axeRun(page, { rules: ["label-content-name-mismatch"], include: ["#qa1r-01"] });
    expect(run.version).toBe(AXE_VERSION);
    expect(run.violations.flatMap((rule) => rule.nodes.map((node) => node.target.join(" ")))).toEqual([
      "#old-brand",
      "#old-search",
    ]);
  });

  test("signals shared work waiting for a mentor's confirmation on the bell, with a dot and in its name", async ({ page }) => {
    await open(page, harness("confirming", "community"));
    const bell = page.getByRole("button", { name: "Attention, 4 shared contributions to confirm" });
    await expect(bell).toBeVisible();
    await expect(bell.locator('[data-count-badge="dot"]')).toBeVisible();
    await expect(bell.locator('[data-count-badge="count"]')).toHaveCount(0);
    await page.screenshot({ path: `${EVIDENCE_DIR}/bell-confirming-${page.viewportSize()!.width}.png` });

    // David without a count from the server: unknown, so no signal and no 0.
    await open(page, harness("david", "community"));
    await expect(page.getByRole("button", { name: /^Attention/ })).not.toHaveAccessibleName(/confirm/);
    await expect(page.getByRole("button", { name: /^Attention/ }).locator('[data-count-badge="dot"]')).toHaveCount(0);
  });

  test("uses Mattone only for the page title, the TEMBO mark and Tembo's T", async ({ page }) => {
    await open(page, harness("every", "discover"));
    const offenders = await page.evaluate(() =>
      Array.from(document.querySelectorAll<HTMLElement>("body *"))
        .filter((element) => element.checkVisibility() && getComputedStyle(element).fontFamily.includes("Mattone"))
        .filter((element) => element.tagName !== "H1" && !element.closest("[data-wordmark], [data-tembo-mark]"))
        .map((element) => element.outerHTML.slice(0, 80)),
    );
    expect(offenders).toEqual([]);
    await expect(page.locator(".spaces-shell h1")).toHaveCount(1);
  });

  test("keeps the row, tabs, tools and bottom bar whole, apart and on screen from 320 to 1440px", async ({ page }) => {
    test.slow();
    for (const persona of SWEEP_PERSONAS) {
      await open(page, harness(persona, "profile"));
      for (const width of SWEEP) {
        await page.setViewportSize({ width, height: 800 });
        await page.waitForTimeout(60);
        const problems = await page.evaluate((isWide) => {
          const found: string[] = [];
          const vw = document.documentElement.clientWidth;
          if (document.documentElement.scrollWidth > vw) found.push("the page scrolls sideways");
          const visible = (el: Element) => (el as HTMLElement).checkVisibility() && el.getBoundingClientRect().width > 0;
          const name = (el: Element) => el.getAttribute("aria-label") ?? el.textContent?.trim().slice(0, 24) ?? el.tagName;
          const sheet = document.querySelector(".platform-sheet")!.getBoundingClientRect();
          const chrome = Array.from(
            document.querySelectorAll(
              ".spaces-shell__brand, .space-tab__link, .space-file__end > *, .spaces-shell__compact-start > *, .spaces-bottom__link",
            ),
          ).filter(visible);
          for (const el of chrome) {
            const box = el.getBoundingClientRect();
            if (box.left < -0.5 || box.right > vw + 0.5) found.push(`"${name(el)}" runs off screen`);
          }
          for (let i = 0; i < chrome.length; i += 1) {
            for (let j = i + 1; j < chrome.length; j += 1) {
              const a = chrome[i].getBoundingClientRect();
              const b = chrome[j].getBoundingClientRect();
              const overlap = Math.min(a.right, b.right) - Math.max(a.left, b.left) > 0.5 && Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top) > 0.5;
              if (overlap) found.push(`"${name(chrome[i])}" overlaps "${name(chrome[j])}"`);
            }
          }
          // The wide row and the phone bar each have their own rules.
          const wideRules = () => {
            const nav = document.querySelector(".space-file__nav")!;
            if (nav.scrollWidth > nav.clientWidth + 1) found.push("the tab strip has to scroll");
            const row = document.querySelector(".space-file__row")!.getBoundingClientRect();
            if (row.height > 64) found.push(`the row wrapped (${Math.round(row.height)}px tall)`);
            for (const link of Array.from(document.querySelectorAll(".space-tab__link"))) {
              const box = link.getBoundingClientRect();
              if (Math.abs(box.bottom - sheet.top) > 3) found.push(`tab "${name(link)}" does not stand on the sheet`);
            }
            // The sheet's rounded top corners belong to the ground: nothing inside paints or hits there.
            const sheetElement = document.querySelector(".platform-sheet")!;
            for (const [x, y] of [[sheet.left + 2, sheet.top + 2], [sheet.right - 3, sheet.top + 2]]) {
              const hit = document.elementFromPoint(x, y);
              if (hit && sheetElement.contains(hit)) found.push(`"${name(hit)}" covers the sheet's rounded corner`);
            }
            const active = document.querySelector(".space-tab[data-active] .space-tab__label")!.getBoundingClientRect();
            if (active.width < 2) found.push("the active tab lost its word");
          };
          const phoneRules = () => {
            const bar = document.querySelector(".spaces-bottom")!.getBoundingClientRect();
            if (Math.abs(bar.bottom - window.innerHeight) > 1) found.push("the bottom bar is not at the bottom");
            const labels = Array.from(document.querySelectorAll(".spaces-bottom__label")).filter((label) => label.getBoundingClientRect().width > 2);
            for (let i = 1; i < labels.length; i += 1) {
              if (labels[i].getBoundingClientRect().left < labels[i - 1].getBoundingClientRect().right) found.push("bottom-bar words collide");
            }
            if (!document.querySelector('.spaces-bottom__link[aria-current="page"] .spaces-bottom__label')!.getBoundingClientRect().width) {
              found.push("the current space lost its word");
            }
          };
          if (isWide) wideRules();
          else phoneRules();
          return found;
        }, width >= 1024);
        expect(problems, `${persona} at ${width}px`).toEqual([]);
      }
    }
  });

  test("lets every word of the chrome and the page be read, scrolling inside the sheet", async ({ page }) => {
    for (const persona of ["every", "unbadged"] as const) {
      await open(page, harness(persona));
      await installTextTracker(page, ".spaces-shell");
      await sampleText(page);
      for (const scroller of ["#spaces-main", "#space-sidebar"]) {
        for (let step = 0; step < 40; step += 1) {
          const moved = await page.evaluate((selector) => {
            const el = document.querySelector<HTMLElement>(selector)!;
            const before = el.scrollTop;
            el.scrollTo({ top: before + el.clientHeight * 0.5, behavior: "instant" });
            return el.scrollTop > before + 1;
          }, scroller);
          await sampleText(page);
          if (!moved) break;
        }
      }
      const report = await textReport(page);
      const issues = report.issues.filter(
        (issue) =>
          !issue.decorative &&
          // Words kept for screen readers only (counts, folded tab labels), and the skip link until focused.
          !issue.reason.startsWith("cropped by clip-path") &&
          !issue.path.includes("sr-only") &&
          !issue.path.includes("spaces-shell__skip") &&
          // A phone's sidebar is a closed drawer; it is read when opened (below).
          (wide(page) || issue.reason !== "visibility hidden"),
      );
      expect(issues, persona).toEqual([]);
      expect(report.maxHorizontalOverflow).toBeLessThanOrEqual(0);
    }
  });

  test("tabs in reading order: past the chrome, the tabs, the tools, the sidebar, then the page", async ({ page }) => {
    test.skip(!wide(page), "The full row is the wide layout's.");
    await open(page, harness("david", "mentoring"));
    const order: string[] = [];
    for (let i = 0; i < 12; i += 1) {
      await page.keyboard.press("Tab");
      order.push(
        await page.evaluate(() => {
          const el = document.activeElement!;
          const label = el.getAttribute("aria-label");
          if (label) return label;
          const copy = el.cloneNode(true) as Element;
          for (const hidden of Array.from(copy.querySelectorAll('[aria-hidden="true"]'))) hidden.remove();
          return Array.from(copy.querySelectorAll("*"))
            .filter((child) => child.children.length === 0)
            .map((child) => child.textContent!.trim())
            .concat(Array.from(copy.childNodes).filter((node) => node.nodeType === 3).map((node) => node.textContent!.trim()))
            .filter(Boolean)
            .join(" ");
        }),
      );
    }
    expect(order).toEqual([
      "Skip to content",
      "Tembo Tech Ventures home",
      "Cohort",
      "Community 1 new",
      "Mentoring 2 new",
      "Profile",
      "Search, Ctrl K",
      "Attention, 3 waiting",
      "Account menu, David Kamau, DK",
      "Requests 2 new",
      "Confirm work",
      "Availability",
    ]);

    await page.goto(harness("david", "mentoring"));
    await expect(page.locator("astro-island[ssr]")).toHaveCount(0);
    await page.keyboard.press("Tab");
    await page.keyboard.press("Enter");
    await expect(page.locator("#spaces-main")).toBeFocused();
  });

  test("opens the drawer as a dialog that holds focus, and gives focus back on Escape", async ({ page }) => {
    test.skip(wide(page), "The drawer is the phone layout's sidebar.");
    await open(page, harness("wanjiku", "cohort"));
    const trigger = page.getByRole("link", { name: "Open Cohort menu" });
    await trigger.click();
    const drawer = page.getByRole("dialog", { name: "Cohort menu" });
    await expect(drawer).toBeVisible();
    await expect(page.getByRole("link", { name: "Close Cohort menu" })).toBeFocused();
    await expect(page.locator("#spaces-main")).toHaveAttribute("inert", "");
    await expect(page.locator(".spaces-bottom")).toHaveAttribute("inert", "");

    // Settled after its slide: wholly on screen.
    await expect.poll(async () => (await drawer.boundingBox())!.x).toBeGreaterThanOrEqual(-0.5);
    const box = (await drawer.boundingBox())!;
    expect(box.x + box.width).toBeLessThanOrEqual(page.viewportSize()!.width);

    const links = await drawer.locator("a[href]").count();
    for (let i = 0; i < links + 2; i += 1) {
      await page.keyboard.press("Tab");
      expect(await page.evaluate(() => Boolean(document.activeElement?.closest("#space-sidebar")))).toBe(true);
    }
    await page.keyboard.press("Shift+Tab");
    expect(await page.evaluate(() => Boolean(document.activeElement?.closest("#space-sidebar")))).toBe(true);

    await installTextTracker(page, "#space-sidebar");
    await page.waitForTimeout(300);
    await sampleText(page);
    expect(
      (await textReport(page)).issues.filter(
        (issue) => !issue.decorative && !issue.reason.startsWith("cropped by clip-path") && !issue.path.includes("sr-only"),
      ),
    ).toEqual([]);

    await page.keyboard.press("Escape");
    await expect(drawer).toBeHidden();
    await expect(trigger).toBeFocused();
    await expect(page.locator("#spaces-main")).not.toHaveAttribute("inert", "");
  });

  test("hands a drawer opened before hydration to the shell, which then closes it every way", async ({ page }) => {
    test.skip(wide(page), "The drawer is the phone layout's sidebar.");
    let release!: () => void;
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    await page.route(/\/SpacesShell\.tsx/, async (route) => {
      await held;
      await route.continue();
    });
    await routeFonts(page);
    await page.goto(harness("wanjiku", "cohort"), { waitUntil: "domcontentloaded" });
    await expect(page.locator(".spaces-shell[data-hydrated]")).toHaveCount(0);

    // Before hydration the menu link is the no-JS fallback: a jump to #space-sidebar.
    await page.getByRole("link", { name: "Open Cohort menu" }).click();
    await expect(page).toHaveURL(/#space-sidebar$/);
    await expect(page.locator("#space-sidebar")).toBeVisible();

    release();
    await expect(page.locator(".spaces-shell[data-hydrated]")).toHaveCount(1);
    const drawer = page.getByRole("dialog", { name: "Cohort menu" });
    const trigger = page.getByRole("link", { name: "Open Cohort menu" });
    await expect(drawer).toBeVisible();
    await expect(page).not.toHaveURL(/#space-sidebar/);
    await expect(page.locator("#spaces-main")).toHaveAttribute("inert", "");

    await page.getByRole("link", { name: "Close Cohort menu" }).click();
    await expect(page.locator("#space-sidebar")).toBeHidden();
    await expect(trigger).toBeFocused();

    // Reaching the fragment again (Back, a shared link) opens it as state, which Escape closes.
    await page.evaluate(() => {
      window.location.hash = "space-sidebar";
    });
    await expect(drawer).toBeVisible();
    await expect(page.getByRole("link", { name: "Close Cohort menu" })).toBeFocused();
    await page.keyboard.press("Escape");
    await expect(page.locator("#space-sidebar")).toBeHidden();
    await expect(trigger).toBeFocused();

    await page.evaluate(() => {
      window.location.hash = "space-sidebar";
    });
    await expect(drawer).toBeVisible();
    const viewport = page.viewportSize()!;
    await page.mouse.click(viewport.width - 12, viewport.height / 2);
    await expect(page.locator("#space-sidebar")).toBeHidden();
  });

  test("never leaves a wide screen with a drawer: widening before hydration, or a #space-sidebar visit", async ({ page }) => {
    const expectPlainSidebar = async () => {
      await expect(page.locator(".spaces-shell[data-hydrated]")).toHaveCount(1);
      await expect(page.locator(".spaces-shell")).toHaveAttribute("data-drawer", "closed");
      await expect(page.getByRole("dialog")).toHaveCount(0);
      await expect(page.locator("#spaces-main")).not.toHaveAttribute("inert", "");
      await expect(page.locator(".space-file__row")).not.toHaveAttribute("inert", "");
      await expect(page.locator("#space-sidebar")).toBeVisible();
      await expect(page).not.toHaveURL(/#space-sidebar/);
    };

    if (!wide(page)) {
      // Open the no-JS drawer on a phone, widen while the shell is still loading, then hydrate.
      let release!: () => void;
      const held = new Promise<void>((resolve) => {
        release = resolve;
      });
      await page.route(/\/SpacesShell\.tsx/, async (route) => {
        await held;
        await route.continue();
      });
      await routeFonts(page);
      await page.goto(harness("wanjiku", "cohort"), { waitUntil: "domcontentloaded" });
      await page.getByRole("link", { name: "Open Cohort menu" }).click();
      await expect(page).toHaveURL(/#space-sidebar$/);
      await page.setViewportSize({ width: 1440, height: 900 });
      release();
      await expectPlainSidebar();
      return;
    }

    await routeFonts(page);
    await page.goto(`${harness("wanjiku", "cohort")}#space-sidebar`);
    await expectPlainSidebar();
    await page.evaluate(() => {
      window.location.hash = "space-sidebar";
    });
    await expectPlainSidebar();
    // The fragment moved the browser's focus starting point into the sidebar; the next stop is its first link.
    await page.keyboard.press("Tab");
    await expect(page.locator("#space-sidebar a", { hasText: "Overview" })).toBeFocused();
  });

  test("opens feedback even when it is asked for before the widget has loaded", async ({ page }) => {
    let release!: () => void;
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    await page.route(/\/FeedbackWidget\.tsx/, async (route) => {
      await held;
      await route.continue();
    });
    await routeFonts(page);
    await page.goto(harness("wanjiku", "community"), { waitUntil: "domcontentloaded" });
    await expect(page.locator(".spaces-shell[data-hydrated]")).toHaveCount(1);
    const { summary, panel } = accountMenu(page);
    await summary.click();
    await panel.getByRole("button", { name: "Feedback" }).click();
    await expect(page.getByRole("dialog")).toHaveCount(0);
    release();
    await expect(page.getByRole("dialog")).toContainText(/feedback/i);
  });

  test("keeps the drawer's focus cycle on controls that can really take focus", async ({ page }) => {
    test.skip(wide(page), "The drawer is the phone layout's sidebar.");
    await open(page, harness("wanjiku", "cohort", "&hidden"));
    await page.getByRole("link", { name: "Open Cohort menu" }).click();
    const close = page.getByRole("link", { name: "Close Cohort menu" });
    await expect(close).toBeFocused();
    await page.keyboard.press("Tab");
    await expect(page.locator("#space-sidebar a", { hasText: "Overview" })).toBeFocused();
    await page.keyboard.press("Shift+Tab");
    await expect(close).toBeFocused();
    await page.keyboard.press("Shift+Tab");
    await expect(page.locator("#space-sidebar a", { hasText: "c04-announcements" })).toBeFocused();
    for (let i = 0; i < 12; i += 1) {
      await page.keyboard.press("Tab");
      const where = await page.evaluate(() => {
        const el = document.activeElement as HTMLElement;
        return {
          inside: Boolean(el.closest("#space-sidebar")),
          visible: el.checkVisibility({ visibilityProperty: true }),
          enabled: !el.matches(":disabled"),
        };
      });
      expect(where).toEqual({ inside: true, visible: true, enabled: true });
    }
  });

  test("works without JavaScript: spaces, the page and the sidebar are all reachable", async ({ browser }, testInfo) => {
    const context = await browser.newContext({ ...testInfo.project.use, javaScriptEnabled: false });
    const page = await context.newPage();
    await page.goto(harness("wanjiku", "cohort"));
    await expect(page.locator("h1")).toHaveText("Cohort");
    const nav = spacesNav(page);
    await expect(nav.getByRole("link", { name: /Community/ })).toHaveAttribute("href", /space=community/);
    await expect(page.locator("#space-sidebar a", { hasText: "Sessions" })).toHaveCount(1);
    if (!wide(page)) {
      await expect(page.locator("#space-sidebar")).toBeHidden();
      await page.getByRole("link", { name: "Open Cohort menu" }).click();
      await expect(page).toHaveURL(/#space-sidebar$/);
      await expect(page.locator("#space-sidebar")).toBeVisible();
      await expect.poll(async () => (await page.locator("#space-sidebar").boundingBox())?.x).toBe(0);
      await page.getByRole("link", { name: "Close Cohort menu" }).click();
      await expect(page.locator("#space-sidebar")).toBeHidden();
    } else {
      await expect(page.locator("#space-sidebar")).toBeVisible();
    }

    // The account disclosure is native, so Account and Sign out need no script either.
    const { summary, panel } = accountMenu(page);
    await expect(panel).toBeHidden();
    await summary.click();
    await expect(panel.getByRole("link", { name: "Account" })).toHaveAttribute("href", "/dashboard/account");
    await expect(panel.getByRole("link", { name: "Sign out" })).toBeVisible();
    await expect(panel.getByRole("button", { name: "Feedback" })).toHaveCount(0);
    await context.close();
  });

  test("opens the account menu from the keyboard and returns focus when it closes", async ({ page }) => {
    await open(page, harness("wanjiku", "community"));
    const { summary, panel } = accountMenu(page);
    await expect(summary).toHaveAttribute("aria-label", "Account menu, Wanjiku Mwangi, WM");
    await summary.focus();
    await page.keyboard.press("Enter");
    await expect(panel).toBeVisible();
    await expect(panel.locator("li > a, li button")).toHaveText(["Account", "Feedback", "Sign out"]);
    await expect(panel.getByRole("link", { name: "Account" })).toHaveAttribute("href", "/dashboard/account");
    await page.keyboard.press("Tab");
    await expect(panel.getByRole("link", { name: "Account" })).toBeFocused();
    await page.keyboard.press("Escape");
    await expect(panel).toBeHidden();
    await expect(summary).toBeFocused();

    await summary.click();
    await page.locator("#spaces-main").click({ position: { x: 5, y: 5 } });
    await expect(panel).toBeHidden();

    await summary.click();
    await panel.getByRole("button", { name: "Feedback" }).click();
    await expect(panel).toBeHidden();
    await expect(page.getByRole("dialog")).toContainText(/feedback/i);
  });

  test("returns keyboard focus to the avatar when the feedback form closes, however late it loaded", async ({ page }) => {
    for (const delayed of [false, true]) {
      let release: () => void = () => {};
      if (delayed) {
        const held = new Promise<void>((resolve) => {
          release = resolve;
        });
        await page.route(/\/FeedbackWidget\.tsx/, async (route) => {
          await held;
          await route.continue();
        });
      }
      await routeFonts(page);
      await page.goto(harness("wanjiku", "community"), { waitUntil: delayed ? "domcontentloaded" : "load" });
      await expect(page.locator(".spaces-shell[data-hydrated]")).toHaveCount(1);
      const { summary, panel } = accountMenu(page);
      await summary.focus();
      await page.keyboard.press("Enter");
      await panel.getByRole("button", { name: "Feedback" }).focus();
      await page.keyboard.press("Enter");
      release();
      const dialog = page.getByRole("dialog");
      await expect(dialog).toContainText(/feedback/i);
      await page.keyboard.press("Escape");
      await expect(dialog).toHaveCount(0);
      await expect(summary, delayed ? "after a delayed widget" : "after a ready widget").toBeFocused();
      await page.unrouteAll({ behavior: "ignoreErrors" });
    }
  });

  test("shows no role chips for a person without role badges", async ({ page }) => {
    await open(page, harness("unbadged", "cohort"));
    await expect(page.locator("[data-role-badge]")).toHaveCount(0);
    await accountMenu(page).summary.click();
    await expect(accountMenu(page).panel).toBeVisible();
    await expect(page.locator("[data-role-badge]")).toHaveCount(0);
  });

  test("asks for search and attention from their triggers and Ctrl K, and gets focus back", async ({ page }) => {
    await open(page, harness("david", "mentoring"));
    const overlay = page.locator("dialog[data-stub-overlay]");
    const search = page.getByRole("button", { name: "Search, Ctrl K" });

    await search.click();
    await expect(overlay).toHaveAttribute("data-stub-overlay", "search");
    await expect(overlay).toContainText("Asked for from its button");
    await overlay.getByRole("button", { name: "Close" }).click();
    await expect(search).toBeFocused();

    await page.locator("#spaces-main").click({ position: { x: 5, y: 5 } });
    await page.keyboard.press("Control+k");
    await expect(overlay).toHaveAttribute("data-stub-overlay", "search");
    await expect(overlay).toContainText("keyboard shortcut");
    await page.keyboard.press("Escape");

    await page.getByRole("button", { name: "Attention, 3 waiting" }).click();
    await expect(overlay).toHaveAttribute("data-stub-overlay", "attention");
    await page.keyboard.press("Escape");
    await expect(page.getByRole("button", { name: "Attention, 3 waiting" })).toBeFocused();
  });

  test("shows no search or bell where no overlay is mounted, and Ctrl K stays the browser's", async ({ page }) => {
    await open(page, harness("david", "mentoring", "&overlays=none"));
    await expect(page.getByRole("button", { name: "Search, Ctrl K" })).toHaveCount(0);
    await expect(page.getByRole("button", { name: /^Attention/ })).toHaveCount(0);
    const prevented = await page.evaluate(() => {
      const event = new KeyboardEvent("keydown", { key: "k", ctrlKey: true, cancelable: true, bubbles: true });
      document.body.dispatchEvent(event);
      return event.defaultPrevented;
    });
    expect(prevented).toBe(false);
  });

  test("switches spaces by sliding the new sheet up in under 300ms, and cuts under reduced motion", async ({ page }) => {
    await page.addInitScript(() => {
      type Reveal = { transition: boolean; longest: number; names: string[]; done: boolean };
      addEventListener("pagereveal", (event) => {
        const transition = (event as Event & { viewTransition: ViewTransition | null }).viewTransition;
        const state: Reveal = { transition: Boolean(transition), longest: 0, names: [], done: !transition };
        (window as unknown as { __reveal: Reveal }).__reveal = state;
        // Once the pseudo-elements exist, read every animation the transition runs.
        const read = async () => {
          await transition?.ready;
          for (const animation of document.getAnimations()) {
            state.longest = Math.max(state.longest, Number(animation.effect!.getComputedTiming().endTime));
            state.names.push((animation as CSSAnimation).animationName);
          }
          state.done = true;
        };
        if (transition) void read();
      });
    });
    await open(page, harness("wanjiku", "cohort"));
    await spacesNav(page).getByRole("link", { name: /Community/ }).click();
    await page.waitForURL(/space=community/);
    await page.waitForFunction(() => (window as unknown as { __reveal?: { done: boolean } }).__reveal?.done);
    const reveal = await page.evaluate(() => (window as unknown as { __reveal: { transition: boolean; longest: number; names: string[] } }).__reveal);
    expect(reveal.transition).toBe(true);
    expect(reveal.names).toContain("spaces-sheet-arrive");
    expect(reveal.longest).toBeGreaterThan(0);
    expect(reveal.longest).toBeLessThan(300);

    await page.emulateMedia({ reducedMotion: "reduce" });
    await spacesNav(page).getByRole("link", { name: /Profile/ }).click();
    await page.waitForURL(/space=profile/);
    await page.waitForFunction(() => (window as unknown as { __reveal?: { done: boolean } }).__reveal?.done);
    const cut = await page.evaluate(() => (window as unknown as { __reveal: { transition: boolean } }).__reveal);
    expect(cut.transition).toBe(false);
  });

  test("gives every control a 44px target on a touch screen", async ({ page }, testInfo) => {
    test.skip(!testInfo.project.name.includes("mobile"), "Touch sizing applies to coarse pointers.");
    await open(page, harness("every", "discover"));
    const small = await page.evaluate(() =>
      Array.from(document.querySelectorAll<HTMLElement>(".spaces-shell a[href], .spaces-shell button, .spaces-shell summary"))
        .filter((el) => el.checkVisibility() && !el.classList.contains("spaces-shell__skip") && !el.closest("#spaces-main"))
        .map((el) => ({ name: el.getAttribute("aria-label") ?? el.textContent?.trim(), box: el.getBoundingClientRect() }))
        .filter(({ box }) => box.width < 43.5 || box.height < 43.5)
        .map(({ name, box }) => `${name} ${Math.round(box.width)}×${Math.round(box.height)}`),
    );
    expect(small).toEqual([]);
  });

  test("never puts the Cookie header or session into island props", async ({ page }) => {
    const response = await page.request.get(harness("wanjiku", "cohort"), {
      headers: { cookie: "ttv-last-space=community; better-auth.session_token=TOPSECRET-session-value" },
    });
    const html = await response.text();
    expect(html).not.toContain("TOPSECRET");
    expect(html).not.toContain("better-auth");
    const props = /component-export="default"[^>]*props="([^"]*lastSpace[^"]*)"/.exec(html)?.[1] ?? "";
    expect(props.replaceAll("&quot;", '"')).toContain('"lastSpace":[0,"community"]');
  });

  test("records the shell for review at 1440 and 390", async ({ page }, testInfo) => {
    const shots: Array<[string, string, string?]> = [
      ["wanjiku-cohort", harness("wanjiku", "cohort")],
      ["david-mentoring", harness("david", "mentoring")],
      ["achieng-profile", harness("achieng", "profile")],
      ["joseph-discover", harness("joseph", "discover")],
      ["amina-admin", harness("amina", "admin")],
      ["every-discover", harness("every", "discover")],
      ["lucy-community-menu", harness("lucy", "community"), "menu"],
      ["wanjiku-cohort-drawer", harness("wanjiku", "cohort"), "drawer"],
    ];
    const size = testInfo.project.name.includes("mobile") ? "390" : "1440";
    if (size === "1440") await page.setViewportSize({ width: 1440, height: 900 });
    else await page.setViewportSize({ width: 390, height: 844 });
    for (const [name, path, state] of shots) {
      await open(page, path);
      if (state === "menu") await accountMenu(page).summary.click();
      if (state === "drawer") {
        if (!wide(page)) await page.getByRole("link", { name: /^Open .* menu$/ }).click();
        else continue;
      }
      await page.waitForTimeout(350);
      await page.screenshot({ path: `${EVIDENCE_DIR}/${name}-${size}.png` });
    }
  });
});
