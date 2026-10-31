import { createHash } from "node:crypto";
import { expect, test, type Locator, type Page, type TestInfo } from "@playwright/test";
import { installTextTracker, textReport, walkAndSample } from "./text-integrity";

/**
 * The platform UI primitives, in a real browser, on `/dev/platform-ui`.
 *
 * Unit tests check the markup and the colour maths; these check what only a
 * browser can: that the active space tab and its sheet render as one surface
 * (read from pixels), that nothing is clipped or scrolls sideways, that axe
 * finds nothing at A/AA, that keyboard focus is visible, that fingers get
 * 44px, that reduced motion holds still, that Mattone appears only on the
 * page's h1, and that the primitives work hydrated.
 *
 * Deployed environments must not serve the harness at all, so against a
 * deployment the only test is that it answers 404.
 */
const HARNESS = "/dev/platform-ui";
const DEPLOYED = Boolean(process.env.PLAYWRIGHT_BASE_URL);
const EVIDENCE_DIR = "test-results/evidence/platform-ui";

test("deployed environments do not serve the harness", async ({ request }) => {
  test.skip(!DEPLOYED, "The local dev server serves the harness on purpose.");
  const response = await request.get(HARNESS, { maxRedirects: 0 });
  expect(response.status()).toBe(404);
});

test.describe("on the dev server", () => {
  test.skip(DEPLOYED, "The harness is dev-only and intentionally unavailable on deployed environments.");

  function isMobile(testInfo: TestInfo) {
    return testInfo.project.name.includes("mobile");
  }

  /** Google Fonts cannot load in the devcontainer's Chromium; fetch them through Node. */
  async function routeFonts(page: Page) {
    await page.route(/fonts\.(googleapis|gstatic)\.com/, async (route) => {
      try {
        const response = await fetch(route.request().url(), { headers: { "user-agent": "Mozilla/5.0 Chrome/120" } });
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

  async function open(page: Page) {
    await routeFonts(page);
    await page.goto(HARNESS);
    await page.addStyleTag({ content: "astro-dev-toolbar { display: none !important; }" });
    await page.evaluate(() => document.fonts.ready);
  }

  async function hydrated(page: Page) {
    await page.locator("[data-playground]").scrollIntoViewIfNeeded();
    await expect(page.locator("astro-island[ssr]")).toHaveCount(0);
  }

  async function shoot(page: Page, testInfo: TestInfo, name: string, target?: Locator) {
    const path = `${EVIDENCE_DIR}/${testInfo.project.name}-${name}.png`;
    await (target ?? page).screenshot({ path });
    await testInfo.attach(name, { path, contentType: "image/png" });
  }

  /** The colour of one rendered pixel, read back through a canvas. */
  async function pixels(page: Page, points: Array<{ x: number; y: number }>) {
    const dpr = await page.evaluate(() => window.devicePixelRatio);
    const png = (await page.screenshot()).toString("base64");
    return page.evaluate(
      async ({ png, points, dpr }) => {
        const image = new Image();
        image.src = `data:image/png;base64,${png}`;
        await image.decode();
        const canvas = document.createElement("canvas");
        canvas.width = image.width;
        canvas.height = image.height;
        const context = canvas.getContext("2d")!;
        context.drawImage(image, 0, 0);
        return points.map(({ x, y }) => Array.from(context.getImageData(Math.round(x * dpr), Math.round(y * dpr), 1, 1).data.slice(0, 3)));
      },
      { png, points, dpr }
    );
  }

  function distance(a: number[], b: number[]) {
    return Math.hypot(...a.map((c, i) => c - b[i]));
  }

  test("nothing scrolls sideways and every word can be read", async ({ page }) => {
    await page.emulateMedia({ reducedMotion: "reduce" });
    await open(page);
    await installTextTracker(page, "main");
    await walkAndSample(page, { settleMs: 120 });
    const report = await textReport(page);
    // Two kinds of text are meant not to be seen: screen-reader-only labels,
    // and the labels of disabled controls, which WCAG exempts and which are
    // faded on purpose. Everything else must be readable.
    const disabled = new Set(
      await page.locator("main button:disabled:not([aria-busy])").evaluateAll((els) => els.map((el) => el.textContent?.trim()))
    );
    const unreadable = report.issues.filter(
      (issue) =>
        !issue.decorative &&
        !/sr-only$/.test(issue.path) &&
        !(issue.reason.startsWith("faded out") && disabled.has(issue.text.trim()))
    );
    expect(unreadable, JSON.stringify(unreadable, null, 2)).toEqual([]);
    expect(report.maxHorizontalOverflow).toBeLessThanOrEqual(1);
    expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBe(0);
  });

  test("axe finds no WCAG A or AA violations", async ({ page }, testInfo) => {
    await open(page);
    await hydrated(page);

    // axe-core is not a dependency; this pinned build is checked against its hash.
    const AXE_URL = "https://cdn.jsdelivr.net/npm/axe-core@4.10.3/axe.min.js";
    const AXE_SHA384 = "17w4i/EfU4m8vRTTBQs69gAb/fjBpQi0/OOcQTspZXbRlDA0OcGoZX3ZUxQpgTYL";
    const source = Buffer.from(await (await fetch(AXE_URL)).arrayBuffer());
    expect(createHash("sha384").update(source).digest("base64")).toBe(AXE_SHA384);
    await page.addScriptTag({ content: source.toString("utf8") });

    const result = await page.evaluate(async () => {
      const axe = (window as unknown as { axe: { run: (context: unknown, options: unknown) => Promise<AxeResult> } }).axe;
      interface AxeResult {
        violations: Array<{ id: string; impact: string; nodes: Array<{ target: string[] }> }>;
        incomplete: Array<{ id: string; nodes: unknown[] }>;
      }
      const run = await axe.run(document, {
        runOnly: { type: "tag", values: ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"] },
      });
      return {
        violations: run.violations.map((v) => ({ id: v.id, impact: v.impact, targets: v.nodes.map((n) => n.target.join(" ")).slice(0, 5) })),
        incomplete: run.incomplete.map((v) => `${v.id} × ${v.nodes.length}`),
      };
    });
    await testInfo.attach("axe-incomplete", { body: result.incomplete.join("\n") || "none", contentType: "text/plain" });
    expect(result.violations, JSON.stringify(result.violations, null, 2)).toEqual([]);
  });

  test("Mattone appears once, on the page's h1, and otherwise only as Tembo's mark", async ({ page }) => {
    await open(page);
    const display = await page.evaluate(() =>
      Array.from(document.querySelectorAll<HTMLElement>("body *"))
        .filter((el) => getComputedStyle(el).fontFamily.includes("Mattone"))
        .filter((el) => Array.from(el.childNodes).some((n) => n.nodeType === Node.TEXT_NODE && n.textContent?.trim()))
        .map((el) => (el.closest("[data-tembo-mark]") ? "tembo" : el.tagName.toLowerCase()))
    );
    expect(display.filter((tag) => tag !== "tembo")).toEqual(["h1"]);
    expect(display.filter((tag) => tag === "tembo").length).toBeGreaterThan(0);
    // Scoped to main: the dev toolbar has headings of its own in a shadow root.
    for (const h2 of await page.locator("main h2").all()) {
      expect(await h2.evaluate((el) => getComputedStyle(el).fontFamily)).toContain("Maven Pro");
    }
  });

  test.describe("the space tabs", () => {
    test("grow out of the sheet with no seam, and the tabs behind tuck under it", async ({ page }, testInfo) => {
      await open(page);
      for (const file of await page.locator("[data-file]").all()) {
        await file.scrollIntoViewIfNeeded();
        const sheet = file.locator("[data-sheet]");
        const sheetBox = (await sheet.boundingBox())!;
        const active = file.locator("[data-space-tab][data-active]");
        const activeBox = (await active.boundingBox())!;

        // The active tab overlaps the sheet's top hairline by a pixel...
        expect(activeBox.y + activeBox.height - sheetBox.y).toBeCloseTo(1, 0);
        // ...and every tab behind tucks its foot under the sheet but shows 44px.
        for (const tab of await file.locator("[data-space-tab]:not([data-active])").all()) {
          const box = (await tab.boundingBox())!;
          expect(box.y + box.height - sheetBox.y).toBeCloseTo(4, 0);
          expect(sheetBox.y - box.y).toBeGreaterThanOrEqual(44);
          expect(box.width).toBeGreaterThanOrEqual(44);
        }

        // Read the junction from pixels: just above the sheet's edge, inside
        // the active tab, the colour is the sheet's (no seam line)...
        const sheetColour = await sheet.evaluate((el) => getComputedStyle(el).backgroundColor);
        const expected = sheetColour.match(/\d+/g)!.slice(0, 3).map(Number);
        const midX = activeBox.x + activeBox.width / 2;
        const [junction, below, filletFoot, filletCorner] = await pixels(page, [
          { x: midX, y: sheetBox.y - 0.5 },
          { x: midX, y: sheetBox.y + 3 },
          // ...the fillet's foot, right beside the tab, is the sheet too...
          { x: activeBox.x - 2, y: sheetBox.y - 1.5 },
          // ...and higher up, in the 4px gap before the next tab, the ground
          // shows through: the fillet is concave, not a square corner.
          { x: activeBox.x - 2, y: sheetBox.y - 12 },
        ]);
        expect(distance(junction, expected), `seam at ${junction}`).toBeLessThan(10);
        expect(distance(below, expected)).toBeLessThan(10);
        expect(distance(filletFoot, expected), `fillet foot ${filletFoot}`).toBeLessThan(14);
        expect(distance(filletCorner, expected), `fillet corner ${filletCorner}`).toBeGreaterThan(8);
      }
      await shoot(page, testInfo, "staff-file", page.locator("[data-file]").nth(2));
    });

    test("are never clipped, in the fixed order, with the active one marked", async ({ page }) => {
      await open(page);
      const viewport = page.viewportSize()!;
      const files = page.locator("[data-file]");
      await expect(files).toHaveCount(3);
      const expectedOrders = [
        ["cohort", "community", "profile"],
        ["community", "mentoring", "profile"],
        ["cohort", "community", "mentoring", "admin", "profile"],
      ];
      for (const [index, order] of expectedOrders.entries()) {
        const file = files.nth(index);
        const tabs = file.locator("[data-space-tab]");
        expect(await tabs.evaluateAll((els) => els.map((el) => el.getAttribute("data-space-tab")))).toEqual(order);
        await expect(file.locator('[aria-current="page"]')).toHaveCount(1);
        const fileBox = (await file.boundingBox())!;
        for (const tab of await tabs.all()) {
          const box = (await tab.boundingBox())!;
          expect(box.x).toBeGreaterThanOrEqual(fileBox.x);
          expect(box.x + box.width).toBeLessThanOrEqual(Math.min(fileBox.x + fileBox.width, viewport.width) + 0.5);
          // Nothing inside the tab spills out of it either. (The fillets are
          // meant to reach outside; they are pseudo-elements, not children.)
          const spill = await tab.evaluate((el) => {
            const outer = el.getBoundingClientRect();
            return Array.from(el.querySelectorAll("*"))
              .map((child) => child.getBoundingClientRect())
              .filter((r) => r.width > 1 && r.height > 1)
              .map((r) => Math.max(outer.left - r.left, r.right - outer.right, outer.top - r.top))
              .reduce((a, b) => Math.max(a, b), 0);
          });
          expect(spill).toBeLessThanOrEqual(0.5);
        }
      }
    });

    test("name every space for screen readers, even when a narrow row shows only markers", async ({ page }, testInfo) => {
      await open(page);
      const staff = page.locator("[data-file]").nth(2).getByRole("navigation", { name: "Spaces" });
      await expect(staff.getByRole("link", { name: /^Community/ })).toHaveAccessibleName("Community 5 new");
      await expect(staff.getByRole("link", { name: /^Admin/ })).toHaveAttribute("aria-current", "page");
      const label = staff.locator('[data-space-tab="community"] [data-space-label]');
      if (isMobile(testInfo)) {
        await expect(label).toHaveClass(/sr-only/);
        expect(await label.evaluate((el) => getComputedStyle(el).position)).toBe("absolute");
      } else {
        expect(await label.evaluate((el) => getComputedStyle(el).position)).toBe("static");
      }
    });
  });

  test("keyboard focus is visible and lifts a tab above the sheet", async ({ page }, testInfo) => {
    test.skip(isMobile(testInfo), "Keyboard focus is checked on the desktop project.");
    await open(page);
    const first = page.locator("[data-file]").first();
    const tabs = first.locator("[data-space-tab]");
    await tabs.first().focus();
    const order: string[] = [];
    for (let i = 0; i < 3; i += 1) {
      const focused = page.locator(":focus");
      order.push((await focused.getAttribute("data-space-tab")) ?? "");
      const style = await focused.evaluate((el) => {
        const s = getComputedStyle(el);
        return { outline: s.outlineStyle, width: s.outlineWidth, z: s.zIndex };
      });
      expect(style.outline).toBe("solid");
      expect(style.width).toBe("2px");
      expect(style.z).toBe("3");
      // The ring's colour eases in with the other colour transitions.
      await expect.poll(() => focused.evaluate((el) => getComputedStyle(el).outlineColor)).toBe("rgb(242, 141, 104)");
      await page.keyboard.press("Tab");
    }
    expect(order).toEqual(["cohort", "community", "profile"]);

    const button = page.locator('[data-catalogue="profile"] button[data-variant="primary"]').first();
    await button.focus();
    await page.keyboard.press("Shift+Tab");
    await page.keyboard.press("Tab");
    await expect(button).toBeFocused();
    expect(await button.evaluate((el) => getComputedStyle(el).outlineStyle)).toBe("solid");
    await shoot(page, testInfo, "focus-ring", button);
  });

  test("every control gives a finger at least 44px", async ({ page }, testInfo) => {
    test.skip(!isMobile(testInfo), "Touch targets apply to coarse pointers.");
    await open(page);
    await hydrated(page);
    expect(await page.evaluate(() => matchMedia("(pointer: coarse)").matches)).toBe(true);
    const controls = page.locator("main button:not([disabled]), main a[href]");
    const count = await controls.count();
    expect(count).toBeGreaterThan(40);
    for (let i = 0; i < count; i += 1) {
      const control = controls.nth(i);
      // The hit area is the box, or a pseudo-element that reaches past it.
      const target = await control.evaluate((el) => {
        const box = el.getBoundingClientRect();
        const before = getComputedStyle(el, "::before");
        const extra = before.position === "absolute" ? -2 * Number.parseFloat(before.top || "0") : 0;
        return { width: box.width, height: box.height + Math.max(0, extra), name: el.textContent?.trim() || el.getAttribute("aria-label") };
      });
      expect(target.height, `${target.name} height`).toBeGreaterThanOrEqual(44);
      expect(target.width, `${target.name} width`).toBeGreaterThanOrEqual(24);
    }
  });

  test("holds still under reduced motion", async ({ page }) => {
    await page.emulateMedia({ reducedMotion: "reduce" });
    await open(page);
    const spinner = page.locator('[data-catalogue="cohort"] [data-spinner]');
    expect(await spinner.evaluate((el) => getComputedStyle(el).animationName)).toBe("none");
    for (const selector of ["button[data-variant]", "[data-reaction]", "[data-space-tab]", "button[aria-label]"]) {
      const property = await page.locator(`main ${selector}`).first().evaluate((el) => getComputedStyle(el).transitionProperty);
      expect(property, selector).toBe("none");
    }
  });

  test("turns the spinner when motion is welcome", async ({ page }) => {
    await page.emulateMedia({ reducedMotion: "no-preference" });
    await open(page);
    const spinner = page.locator('[data-catalogue="cohort"] [data-spinner]');
    expect(await spinner.evaluate((el) => getComputedStyle(el).animationName)).toBe("spin");
  });

  test("the primitives work inside a React island", async ({ page }, testInfo) => {
    await open(page);
    await hydrated(page);
    const playground = page.locator("[data-playground]");

    const useful = playground.getByRole("button", { name: /^Useful/ });
    await expect(useful).toHaveAttribute("aria-pressed", "false");
    await expect(useful).toHaveAccessibleName("Useful, 6 people");
    await useful.click();
    await expect(useful).toHaveAttribute("aria-pressed", "true");
    await expect(useful).toHaveAccessibleName("Useful, 7 people");
    await useful.click();
    await expect(useful).toHaveAccessibleName("Useful, 6 people");

    const send = playground.getByRole("button", { name: "Send" });
    await send.click();
    const sending = playground.getByRole("button", { name: "Sending" });
    await expect(sending).toHaveAttribute("aria-busy", "true");
    await expect(sending).toBeDisabled();
    await expect(playground.getByRole("button", { name: "Send" })).toBeEnabled();
    await expect(playground.locator("output")).toHaveText("Sent 1 time.");

    const attention = playground.getByRole("button", { name: /^Attention/ });
    await expect(attention).toHaveAccessibleName("Attention, 4 waiting");
    await attention.click();
    await expect(attention).toHaveAttribute("aria-pressed", "true");
    await expect(attention).toHaveAccessibleName("Attention");
    await shoot(page, testInfo, "island", playground);
  });

  test("evidence screenshots", async ({ page }, testInfo) => {
    await open(page);
    await hydrated(page);
    await page.evaluate(() => window.scrollTo(0, 0));
    await shoot(page, testInfo, "top");
    for (const [index, persona] of ["student", "mentor", "staff"].entries()) {
      await shoot(page, testInfo, `persona-${persona}`, page.locator("[data-persona]").nth(index));
    }
    for (const tone of ["admin", "profile"]) {
      await shoot(page, testInfo, `tone-${tone}`, page.locator(`[data-catalogue="${tone}"]`));
    }
  });
});
