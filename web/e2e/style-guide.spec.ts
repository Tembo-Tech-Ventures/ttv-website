import { expect, test, type Page } from "@playwright/test";
import { runAxe } from "./platform-axe";

/**
 * The public style guide (/style-guide): five pages in a tab file, rendering
 * the kit's real components. It is public, so this runs against local dev
 * servers and deployed previews alike.
 */

const SECTIONS = [
  { path: "/style-guide", tab: "Principles", title: "Style guide" },
  { path: "/style-guide/foundations", tab: "Foundations", title: "Foundations" },
  { path: "/style-guide/components", tab: "Components", title: "Components" },
  { path: "/style-guide/patterns", tab: "Patterns", title: "Patterns" },
  { path: "/style-guide/voice", tab: "Voice", title: "Voice" },
] as const;

async function open(page: Page, path: string) {
  await page.goto(path);
  await page.evaluate(() => document.fonts.ready);
  // Islands hydrate when visible; nothing below waits on one it has not scrolled to.
  await page.addStyleTag({ content: "astro-dev-toolbar { display: none !important; }" });
}

for (const section of SECTIONS) {
  test.describe(`${section.tab}`, () => {
    test("passes axe at WCAG 2.2 A and AA", async ({ page }, testInfo) => {
      await open(page, section.path);
      await runAxe(page, testInfo, `style-guide-${section.tab.toLowerCase()}`, { include: ["main"] });
    });

    test("is titled, and stands on its own tab", async ({ page }) => {
      await open(page, section.path);
      await expect(page.locator("main h1")).toHaveText(section.title);
      const tabs = page.getByRole("navigation", { name: "Style guide" });
      await expect(tabs.getByRole("link")).toHaveText(SECTIONS.map((candidate) => candidate.tab));
      await expect(tabs.locator('[aria-current="page"]')).toHaveText(section.tab);
    });

    test("never scrolls sideways, and keeps its tabs on the sheet, from 320px up", async ({ page }) => {
      for (const width of [320, 390, 768, 1440]) {
        await page.setViewportSize({ width, height: 900 });
        await open(page, section.path);
        const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
        expect(overflow, `${width}px`).toBeLessThanOrEqual(0);

        const geometry = await page.evaluate(() => {
          const file = document.querySelector("[data-style-guide] .space-file")!;
          const strip = file.querySelector(".space-file__nav")!.getBoundingClientRect();
          const sheetBox = file.querySelector(":scope > [data-sheet]")!.getBoundingClientRect();
          const active = file.querySelector('.space-file__nav [aria-current="page"]')!.getBoundingClientRect();
          return { strip, sheet: sheetBox, active };
        });
        expect(geometry.strip.left, `${width}px strip left`).toBeGreaterThanOrEqual(geometry.sheet.left - 1);
        expect(geometry.strip.right, `${width}px strip right`).toBeLessThanOrEqual(geometry.sheet.right + 1);
        // The strip opens on the page you are on, whole, even when it has to scroll.
        expect(geometry.active.left, `${width}px active tab`).toBeGreaterThanOrEqual(geometry.strip.left - 1);
        expect(geometry.active.right, `${width}px active tab`).toBeLessThanOrEqual(geometry.strip.right + 1);
        // The tab stands on the sheet: its foot meets the sheet's head.
        expect(Math.abs(geometry.active.bottom - geometry.sheet.top), `${width}px tab foot`).toBeLessThanOrEqual(3);
      }
    });

    test("lists its sections, each of which exists", async ({ page }, testInfo) => {
      await open(page, section.path);
      const wide = !testInfo.project.name.includes("mobile") && (page.viewportSize()?.width ?? 0) >= 1024;
      const contents = wide
        ? page.getByRole("navigation", { name: "On this page" })
        : page.locator("main details").filter({ has: page.locator("summary", { hasText: "On this page" }) });
      if (!wide) await contents.locator("summary").click();
      const hrefs = await contents.getByRole("link").evaluateAll((links) => links.map((link) => link.getAttribute("href")));
      expect(hrefs.length).toBeGreaterThan(2);
      for (const href of hrefs) await expect(page.locator(href!)).toHaveCount(1);
    });
  });
}

test("moves between sections from the keyboard", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name.includes("mobile"), "Keyboard order is a desktop concern.");
  await open(page, "/style-guide");
  const tabs = page.getByRole("navigation", { name: "Style guide" }).getByRole("link");
  await tabs.first().focus();
  await page.keyboard.press("Tab");
  await expect(tabs.nth(1)).toBeFocused();
  const ring = await tabs.nth(1).evaluate((link) => getComputedStyle(link).outlineStyle);
  expect(ring).toBe("solid");
  await page.keyboard.press("Enter");
  await expect(page).toHaveURL(/\/style-guide\/foundations$/);
  await expect(page.locator("main h1")).toHaveText("Foundations");
});

test("reads and navigates without JavaScript", async ({ browser }) => {
  const context = await browser.newContext({ javaScriptEnabled: false });
  const page = await context.newPage();
  for (const section of SECTIONS) {
    const response = await page.goto(section.path);
    expect(response?.status()).toBe(200);
    await expect(page.locator("main h1")).toHaveText(section.title);
  }
  // Server-rendered demonstrations are already in their resting state.
  await page.goto("/style-guide/components#pill");
  await expect(page.locator('[data-live="pill"]').getByRole("button", { name: /Needs a decision/ })).toHaveAttribute("aria-pressed", "true");
  await context.close();
});

test.describe("the demonstrations", () => {
  test("filter, send, react and toggle when pressed", async ({ page }) => {
    await open(page, "/style-guide/components");

    const pill = page.locator('[data-live="pill"]');
    await pill.scrollIntoViewIfNeeded();
    await expect(pill.locator("astro-island[ssr]")).toHaveCount(0, { timeout: 20_000 });
    await pill.getByRole("button", { name: /Decided/ }).click();
    await expect(pill.getByRole("button", { name: /Decided/ })).toHaveAttribute("aria-pressed", "true");
    await expect(pill.getByRole("listitem")).toHaveText([/Achieng Otieno/]);

    const button = page.locator('[data-live="button"]');
    await button.scrollIntoViewIfNeeded();
    await expect(button.locator("astro-island[ssr]")).toHaveCount(0, { timeout: 20_000 });
    await button.getByRole("button", { name: "Send request" }).click();
    await expect(button.getByRole("button")).toHaveAttribute("aria-busy", "true");
    await expect(button.getByRole("status")).toContainText("Sent.", { timeout: 5_000 });

    const reaction = page.locator('[data-live="reaction"]');
    await reaction.scrollIntoViewIfNeeded();
    await expect(reaction.locator("astro-island[ssr]")).toHaveCount(0, { timeout: 20_000 });
    const learned = reaction.getByRole("button", { name: /Learned something/ });
    await expect(learned).toHaveAttribute("aria-pressed", "false");
    await learned.click();
    await expect(learned).toHaveAttribute("aria-pressed", "true");
    await expect(learned).toContainText("· 3");

    const toggles = page.locator('[data-live="icon-button"]');
    await toggles.scrollIntoViewIfNeeded();
    await expect(toggles.locator("astro-island[ssr]")).toHaveCount(0, { timeout: 20_000 });
    const bell = toggles.getByRole("button", { name: "Attention, 4 waiting" });
    await bell.click();
    await expect(toggles.getByRole("button", { name: "Attention" })).toBeVisible();
  });

  test("holds the loading mark still under reduced motion", async ({ page }) => {
    await page.emulateMedia({ reducedMotion: "reduce" });
    await open(page, "/style-guide/components");
    const button = page.locator('[data-live="button"]');
    await button.scrollIntoViewIfNeeded();
    await expect(button.locator("astro-island[ssr]")).toHaveCount(0, { timeout: 20_000 });
    await button.getByRole("button", { name: "Send request" }).click();
    const spinner = button.locator("[data-spinner]");
    await expect(spinner).toBeVisible();
    expect(await spinner.evaluate((mark) => getComputedStyle(mark).animationName)).toBe("none");
  });
});

test("is linked from every public page's footer", async ({ page }) => {
  await open(page, "/");
  const link = page.locator("footer").getByRole("link", { name: "Style guide", exact: true });
  await expect(link).toHaveAttribute("href", "/style-guide");
});

test("draws every checkbox and radio 20px, and makes each a 44px target on a touch screen without moving its row", async ({ page }, testInfo) => {
  const touch = testInfo.project.name.includes("mobile");
  await open(page, "/style-guide/components");
  const boxes = await page.locator("main input.kit-choice").evaluateAll((inputs) =>
    inputs.map((input) => {
      const outer = input.getBoundingClientRect();
      const border = Number.parseFloat(getComputedStyle(input).borderTopWidth);
      return { width: Math.round(outer.width), height: Math.round(outer.height), drawn: Math.round(outer.width - 2 * border) };
    }),
  );
  expect(boxes.length).toBeGreaterThan(4);
  for (const box of boxes) {
    expect(box.drawn).toBe(20);
    expect(Math.min(box.width, box.height)).toBe(touch ? 44 : 20);
  }
  // The drawn box sits where an unenlarged one would: its label starts the same distance from it.
  const gap = await page.locator("#fields [data-choice='checkbox']").first().evaluate((row) => {
    const input = row.querySelector("input")!;
    const border = Number.parseFloat(getComputedStyle(input).borderLeftWidth);
    return Math.round(row.querySelector("label")!.getBoundingClientRect().left - (input.getBoundingClientRect().right - border));
  });
  expect(gap).toBe(12);
});

test("stacks a data table on a phone, each fact said with its column, and never scrolls sideways", async ({ page }, testInfo) => {
  await open(page, "/style-guide/components");
  const table = page.locator("#data-table table");
  const display = await table.evaluate((element) => getComputedStyle(element).display);
  if ((page.viewportSize()?.width ?? 0) < 640) {
    expect(display).toBe("block");
    const cohort = table.locator("td[data-label='Cohort']").first();
    expect(await cohort.evaluate((cell) => getComputedStyle(cell, "::before").content)).toContain("Cohort");
  } else {
    expect(display, testInfo.project.name).toBe("table");
  }
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await expect(table.getByRole("checkbox", { name: "Select Wanjiku Mwangi" })).toBeVisible();
  await expect(table.getByRole("link", { name: "Review Wanjiku Mwangi" })).toBeVisible();
});

test("makes the link that names a row a 44px target on a touch screen, without moving the row", async ({ page }, testInfo) => {
  const touch = testInfo.project.name.includes("mobile");
  await open(page, "/style-guide/components");
  const name = page.locator("#data-table td[data-primary] a").first();
  const measured = await name.evaluate((link) => {
    const row = link.closest("tr")!;
    const pressable = { link: link.getBoundingClientRect().height, row: row.getBoundingClientRect().height };
    // The same row with the press area taken away: it must be exactly as tall.
    link.style.padding = "0";
    link.style.margin = "0";
    const without = { link: link.getBoundingClientRect().height, row: row.getBoundingClientRect().height };
    link.style.padding = "";
    link.style.margin = "";
    return { link: Math.round(pressable.link), text: Math.round(without.link), row: Math.round(pressable.row), bareRow: Math.round(without.row) };
  });
  // On touch the padding is sized for the smallest names (a 17-18px box), so a larger one gets a little more than 44.
  if (touch) expect(measured.link).toBeGreaterThanOrEqual(Math.max(44, measured.text));
  else expect(measured.link).toBe(measured.text);
  expect(measured.row).toBe(measured.bareRow);
});

test.describe("the call room's parts", () => {
  async function hydrated(page: Page, demo: string) {
    const live = page.locator(`[data-live="${demo}"]`);
    await live.scrollIntoViewIfNeeded();
    await expect(live.locator("astro-island[ssr]")).toHaveCount(0, { timeout: 20_000 });
    return live;
  }

  test("a dialog in an island keeps focus inside, closes on Escape and gives focus back", async ({ page }, testInfo) => {
    await open(page, "/style-guide/components");
    const demo = await hydrated(page, "dialog");
    const trigger = demo.getByRole("button", { name: "Withdraw request" });
    await trigger.focus();
    await page.keyboard.press("Enter");

    const dialog = page.getByRole("dialog", { name: "Withdraw your request to David Kamau?" });
    await expect(dialog).toBeVisible();
    await expect(dialog).toHaveAccessibleDescription("David won't see it any more. You can ask again later.");
    const cancel = dialog.getByRole("button", { name: "Cancel" });
    const confirm = dialog.getByRole("button", { name: "Withdraw request" });
    await expect(cancel).toBeFocused();
    await page.keyboard.press("Tab");
    await expect(confirm).toBeFocused();
    await page.keyboard.press("Tab");
    await expect(cancel).toBeFocused();
    await page.keyboard.press("Shift+Tab");
    await expect(confirm).toBeFocused();
    await runAxe(page, testInfo, "style-guide-dialog-open", { include: ["main"] });

    await page.keyboard.press("Escape");
    await expect(dialog).toBeHidden();
    await expect(trigger).toBeFocused();
    await expect(demo.getByRole("status")).toHaveText("Kept. Nothing changed.");
  });

  test("a dialog on a static page opens, closes on Escape and gives focus back with no script at all", async ({ browser }) => {
    const context = await browser.newContext({ javaScriptEnabled: false });
    const page = await context.newPage();
    await page.goto("/style-guide/components#dialog");
    const trigger = page.locator("#dialog").getByRole("button", { name: "Delete draft" });
    await trigger.click();
    const dialog = page.getByRole("dialog", { name: "Delete the draft “Chama ledger”?" });
    await expect(dialog).toBeVisible();
    await expect(dialog.getByRole("button", { name: "Cancel" })).toBeFocused();
    await page.keyboard.press("Escape");
    await expect(dialog).toBeHidden();
    await expect(trigger).toBeFocused();
    // The way out is a method="dialog" form, which the browser closes on its own.
    await trigger.click();
    await dialog.getByRole("button", { name: "Cancel" }).click();
    await expect(dialog).toBeHidden();
    await context.close();
  });

  test("an announcer says a burst of arrivals once, as one sentence", async ({ page }) => {
    await open(page, "/style-guide/components");
    const demo = await hydrated(page, "announcer");
    const join = demo.getByRole("button", { name: "Three people join" });
    await join.click();
    await expect(demo.locator('[data-live-announcer="guide-announcer"] output')).toHaveText("Kevin Omondi and 2 others joined", { timeout: 5_000 });
    // The same burst again straight away is the same news: it is not said twice.
    await join.click();
    await page.waitForTimeout(2_500);
    await expect(demo.getByRole("listitem")).toHaveText(["Politely: Kevin Omondi and 2 others joined"]);

    await demo.getByRole("button", { name: "Start recording" }).click();
    await expect(demo.locator('[data-live-announcer="guide-announcer"] [role="alert"]')).toHaveText("Recording started");
  });

  test("a countdown changes once a minute, then says the last minute and the last ten seconds once each", async ({ page }) => {
    await page.clock.install();
    await open(page, "/style-guide/components");
    const demo = await hydrated(page, "countdown");
    // From here the page's time moves only when the test says.
    await page.clock.pauseAt(Date.now() + 1_000);
    await demo.getByRole("button", { name: "Start a 70-second countdown" }).click();
    const timer = demo.getByRole("timer");
    await expect(timer).toHaveText(/2 min left/);
    await expect(demo.locator("[data-countdown]")).toHaveCSS("font-variant-numeric", "tabular-nums");

    await page.clock.runFor(11_500);
    await expect(timer).toHaveText(/0:59 left/);
    const alert = demo.locator('[data-live-announcer="guide-countdown"] [role="alert"]');
    await expect(alert).toHaveText("The demonstration ends in 1 minute.");

    await page.clock.runFor(50_000);
    await expect(alert).toHaveText("The demonstration ends in 10 seconds.");
    await page.clock.runFor(11_000);
    await expect(timer).toHaveText(/Ending now/);
    await expect(demo.getByRole("listitem")).toHaveText(["At once: The demonstration ends in 1 minute.", "At once: The demonstration ends in 10 seconds."]);
  });

  test("a countdown moves through its last minute in steps of ten seconds under reduced motion", async ({ page }) => {
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.clock.install();
    await open(page, "/style-guide/components");
    const demo = await hydrated(page, "countdown");
    await page.clock.pauseAt(Date.now() + 1_000);
    await demo.getByRole("button", { name: "Start a 70-second countdown" }).click();
    const timer = demo.getByRole("timer");
    await page.clock.runFor(11_000);
    await expect(timer).toHaveText(/1:00 left/);
    await page.clock.runFor(5_000);
    await expect(timer).toHaveText(/1:00 left/);
    await page.clock.runFor(5_000);
    await expect(timer).toHaveText(/0:50 left/);
    await expect(demo.locator("[data-countdown]")).toHaveCSS("transition-property", "none");
  });

  test("gives every control in them a 44px target on a touch screen", async ({ page }, testInfo) => {
    test.skip(!testInfo.project.name.includes("mobile"), "Targets grow on a coarse pointer.");
    await open(page, "/style-guide/components");
    const sizes = async (selector: string) =>
      page.locator(selector).evaluateAll((buttons) =>
        buttons.filter((button) => button.getClientRects().length > 0).map((button) => {
          const box = button.getBoundingClientRect();
          return Math.round(Math.min(box.width, box.height));
        }),
      );
    for (const id of ["dialog", "live-announcer", "countdown"]) {
      const measured = await sizes(`#${id} button`);
      expect(measured.length, id).toBeGreaterThan(0);
      for (const size of measured) expect(size, id).toBeGreaterThanOrEqual(44);
    }
    await page.locator("#dialog").getByRole("button", { name: "Delete draft" }).click();
    const inside = await sizes("dialog[open] button");
    expect(inside).toHaveLength(2);
    for (const size of inside) expect(size).toBeGreaterThanOrEqual(44);
    expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(0);
  });
});
