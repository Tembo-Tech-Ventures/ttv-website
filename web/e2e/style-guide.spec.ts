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
      const contents = wide ? page.getByRole("navigation", { name: "On this page" }) : page.locator("main details");
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
