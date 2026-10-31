import { expect, test, type Page, type TestInfo } from "@playwright/test";

/**
 * The browser contract for the platform UI primitives (U-0.1).
 *
 * These run against `/dev/platform-ui`, a DEV-only harness that renders every
 * primitive in every state on each space's sheet, the assembled tab row and
 * sheet for three people, and one hydrated island. Unit tests cover the markup;
 * this covers what only a browser can see: the tab geometry and the pixels
 * where a tab meets its sheet, contrast on the surfaces text really lands on,
 * focus rings, touch targets and motion.
 */
const HARNESS = "/dev/platform-ui";
const EVIDENCE_DIR = "test-results/evidence/platform-ui";
const PERSONAS = ["student", "mentor", "staff"] as const;

test.describe("on a deployed build", () => {
  test.skip(!process.env.PLAYWRIGHT_BASE_URL, "Only deployed builds prove the harness is absent.");

  test("the primitives harness does not exist", async ({ page }) => {
    const response = await page.goto(HARNESS);
    expect(response?.status()).toBe(404);
  });
});

test.describe("the primitives harness", () => {
  test.skip(
    Boolean(process.env.PLAYWRIGHT_BASE_URL),
    "The harness is dev-only and intentionally unavailable on deployed environments.",
  );

  async function open(page: Page) {
    await page.goto(HARNESS);
    // The island hydrates after load; Astro drops `ssr` once it is live.
    await expect(page.locator("astro-island[ssr]")).toHaveCount(0);
    await page.evaluate(() => document.fonts.ready);
    await page.addStyleTag({ content: "astro-dev-toolbar { display: none !important; }" });
  }

  function isMobile(testInfo: TestInfo) {
    return testInfo.project.name.includes("mobile");
  }

  test("shows each person's spaces in order and every tone", async ({ page }) => {
    await open(page);
    await expect(page.getByRole("heading", { level: 1, name: "Platform primitives" })).toBeVisible();

    const expected = {
      student: { tabs: ["Cohort", "Community", "Profile"], active: "Cohort" },
      mentor: { tabs: ["Community", "Mentoring", "Profile"], active: "Mentoring" },
      staff: { tabs: ["Cohort", "Community", "Mentoring", "Admin", "Profile"], active: "Admin" },
    };
    for (const persona of PERSONAS) {
      const nav = page.locator(`[data-persona=${persona}]`).getByRole("navigation", { name: "Spaces" });
      const labels = await nav.locator(".space-tab__label").allTextContents();
      expect(labels).toEqual(expected[persona].tabs);
      await expect(nav.locator('[aria-current="page"]')).toHaveCount(1);
      await expect(nav.locator('[aria-current="page"] .space-tab__label')).toHaveText(expected[persona].active);
    }

    for (const space of ["cohort", "community", "mentoring", "discover", "admin", "profile"]) {
      await expect(page.getByRole("heading", { level: 3, name: new RegExp(`^${space} sheet$`, "i") })).toBeVisible();
    }
  });

  test("uses Mattone only for the page title and the Tembo mark", async ({ page }) => {
    await open(page);
    const offenders = await page.evaluate(() =>
      Array.from(document.querySelectorAll<HTMLElement>("body *"))
        .filter((element) => getComputedStyle(element).fontFamily.includes("Mattone"))
        .filter((element) => element.tagName !== "H1" && !element.closest("[data-tembo-mark]"))
        .map((element) => element.outerHTML.slice(0, 80)),
    );
    expect(offenders).toEqual([]);
  });

  test("never scrolls sideways", async ({ page }) => {
    await open(page);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  });

  test("stands every tab on the sheet's flat edge, with the active one raised and fused", async ({ page }) => {
    await open(page);
    for (const persona of PERSONAS) {
      const file = page.locator(`[data-persona=${persona}] .space-file`);
      const geometry = await file.evaluate((root) => {
        const rect = (element: Element) => element.getBoundingClientRect();
        const sheet = rect(root.querySelector(".platform-sheet")!);
        const style = getComputedStyle(root.querySelector(".space-file__row")!);
        const radius = Number.parseFloat(style.getPropertyValue("--sheet-radius"));
        const fillet = Number.parseFloat(getComputedStyle(root.querySelector(".space-tab")!).getPropertyValue("--fillet"));
        const tabs = Array.from(root.querySelectorAll(".space-tab")).map((tab) => {
          const link = tab.querySelector(".space-tab__link")!;
          const label = tab.querySelector<HTMLElement>(".space-tab__label")!;
          const box = rect(link);
          return {
            active: tab.hasAttribute("data-active"),
            top: box.top,
            bottom: box.bottom,
            left: box.left,
            right: box.right,
            clipped: label.getBoundingClientRect().width > 1 && label.scrollWidth > label.clientWidth + 0.5,
          };
        });
        return { sheet: { top: sheet.top, left: sheet.left, right: sheet.right }, radius, fillet, tabs };
      });

      const { sheet, radius, fillet, tabs } = geometry;
      const active = tabs.find((tab) => tab.active)!;
      // Sunk into the sheet by a hair, never floating above it or lost in it.
      for (const tab of tabs) {
        expect(tab.bottom - sheet.top, `${persona}: tab bottom vs sheet top`).toBeGreaterThan(0.5);
        expect(tab.bottom - sheet.top, `${persona}: tab bottom vs sheet top`).toBeLessThanOrEqual(3);
        expect(tab.clipped, `${persona}: a tab label is clipped`).toBe(false);
        if (!tab.active) expect(active.top, `${persona}: active tab is raised`).toBeLessThan(tab.top);
      }
      // Fillets land on the flat edge, clear of the sheet's rounded corners.
      expect(tabs[0].left - fillet).toBeGreaterThanOrEqual(sheet.left + radius - 0.5);
      expect(tabs.at(-1)!.right + fillet).toBeLessThanOrEqual(sheet.right - radius + 0.5);
    }
  });

  test("leaves no seam where the active tab meets its sheet", async ({ page }) => {
    await open(page);
    for (const persona of PERSONAS) {
      const file = page.locator(`[data-persona=${persona}] .space-file`);
      await file.scrollIntoViewIfNeeded();
      const box = await file.evaluate((root) => {
        const tab = root.querySelector(".space-tab[data-active] .space-tab__link")!.getBoundingClientRect();
        const sheetElement = root.querySelector(".platform-sheet")!;
        const sheet = sheetElement.getBoundingClientRect();
        const fillet = Number.parseFloat(getComputedStyle(root.querySelector(".space-tab")!).getPropertyValue("--fillet"));
        return { left: tab.left, right: tab.right, sheetTop: sheet.top, fillet, colour: getComputedStyle(sheetElement).backgroundColor };
      });

      // Every pixel where the tab meets the sheet must be the sheet's own
      // colour: no lit edge showing through, no hairline of ground, no gap.
      // Two bands: the three rows above the sheet's edge under the tab itself,
      // and from just above the edge into the sheet across the inner half of
      // both fillets (their outer halves are meant to curve away).
      const bands = [
        { x: box.left + 1, y: box.sheetTop - 3, width: box.right - box.left - 2, height: 3 },
        { x: box.left - box.fillet / 2 + 1, y: box.sheetTop - 1, width: box.right - box.left + box.fillet - 2, height: 4 },
      ].map((band) => ({ x: Math.ceil(band.x), y: Math.round(band.y), width: Math.floor(band.width), height: band.height }));
      const pixels = (
        await Promise.all(
          bands.map(async (clip) => decode(page, await page.screenshot({ clip, scale: "css", animations: "disabled" }))),
        )
      ).flat();
      const sheetRgb = box.colour.match(/\d+/g)!.slice(0, 3).map(Number);
      const off = pixels.filter(([r, g, b]) => Math.max(Math.abs(r - sheetRgb[0]), Math.abs(g - sheetRgb[1]), Math.abs(b - sheetRgb[2])) > 3);
      expect(off.length, `${persona}: ${off.length} of ${pixels.length} pixels at the join are not the sheet's colour`).toBe(0);
    }
  });

  test("keeps every word at 4.5:1 or better on the surface behind it", async ({ page }) => {
    await open(page);
    const failures = await page.evaluate(() => {
      const canvas = document.createElement("canvas");
      canvas.width = canvas.height = 1;
      const context = canvas.getContext("2d", { willReadFrequently: true })!;
      /** Any CSS colour (oklab, color-mix, rgb) to straight RGBA via the canvas. */
      function rgba(css: string): [number, number, number, number] {
        context.clearRect(0, 0, 1, 1);
        context.fillStyle = "#000";
        context.fillStyle = css;
        context.fillRect(0, 0, 1, 1);
        const [r, g, b, a] = context.getImageData(0, 0, 1, 1).data;
        return [r, g, b, a / 255];
      }
      const over = (top: number[], base: number[]) => [0, 1, 2].map((i) => top[3] * top[i] + (1 - top[3]) * base[i]);
      const luminance = (rgb: number[]) => {
        const [r, g, b] = rgb.map((c) => {
          const v = c / 255;
          return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
        });
        return 0.2126 * r + 0.7152 * g + 0.0722 * b;
      };
      function background(element: Element): number[] {
        const layers: number[][] = [];
        for (let node: Element | null = element; node; node = node.parentElement) {
          const colour = rgba(getComputedStyle(node).backgroundColor);
          if (colour[3] > 0) layers.push(colour);
          if (colour[3] >= 1) break;
        }
        return layers.reduceRight<number[]>((base, layer) => over(layer, base), [255, 255, 255]);
      }
      const results: string[] = [];
      for (const element of Array.from(document.querySelectorAll<HTMLElement>("body *"))) {
        const ownText = Array.from(element.childNodes).some((node) => node.nodeType === 3 && node.textContent!.trim());
        if (!ownText) continue;
        const box = element.getBoundingClientRect();
        if (box.width <= 1 || box.height <= 1) continue; // visually hidden text
        if (element.closest("button:disabled")) continue; // WCAG exempts inactive controls
        const style = getComputedStyle(element);
        const bg = background(element);
        const fg = over(rgba(style.color), bg);
        const [hi, lo] = [luminance(fg), luminance(bg)].toSorted((a, b) => b - a);
        const ratio = (hi + 0.05) / (lo + 0.05);
        const size = Number.parseFloat(style.fontSize);
        const large = size >= 24 || (size >= 18.66 && Number(style.fontWeight) >= 700);
        if (ratio < (large ? 3 : 4.5)) results.push(`${ratio.toFixed(2)}:1 "${element.textContent!.trim().slice(0, 30)}"`);
      }
      return results;
    });
    expect(failures).toEqual([]);
  });

  test("shows a focus ring on every control, in reading order", async ({ page }) => {
    await open(page);
    // Within the harness: Astro's dev toolbar adds controls of its own.
    const total = await page.locator("main").locator("a[href], button:not(:disabled)").count();
    const seen: { name: string; region: number; ringed: boolean }[] = [];
    for (let step = 0; step < total; step += 1) {
      await page.keyboard.press("Tab");
      const focused = await page.evaluate(() => {
        const element = document.activeElement as HTMLElement | null;
        if (!element || element === document.body) return null;
        const style = getComputedStyle(element);
        return {
          name: element.getAttribute("aria-label") ?? element.textContent?.trim().slice(0, 40) ?? "",
          // The region (a person's file, a tone's sheet, the island) it sits in.
          region: (element.closest("figure, section[data-sheet], [data-interactive]") ?? element).getBoundingClientRect().top + window.scrollY,
          ringed: style.outlineStyle !== "none" && Number.parseFloat(style.outlineWidth) >= 2,
        };
      });
      if (focused) seen.push(focused);
    }
    expect(seen.length).toBe(total);
    expect(seen.filter((entry) => !entry.ringed).map((entry) => entry.name)).toEqual([]);

    // Within a region, Tab follows the DOM (a grid of groups reads row by
    // row); across regions it must never jump back up the page.
    const backwards = seen.filter((entry, index) => index > 0 && entry.region < seen[index - 1].region - 1);
    expect(backwards.map((entry) => entry.name)).toEqual([]);
    expect(await page.locator("main [tabindex]:not([tabindex='0']):not([tabindex='-1'])").count()).toBe(0);
  });

  test("gives every control a 44px target on a touch screen", async ({ page }, testInfo) => {
    test.skip(!isMobile(testInfo), "Touch targets are a coarse-pointer guarantee.");
    await open(page);
    const small = await page.evaluate(() =>
      Array.from(document.querySelectorAll<HTMLElement>("main a[href], main button"))
        .map((element) => ({ element, box: element.getBoundingClientRect() }))
        .filter(({ box }) => box.width < 43.5 || box.height < 43.5)
        .map(({ element, box }) => `${element.getAttribute("aria-label") ?? element.textContent?.trim()} ${box.width}x${box.height}`),
    );
    expect(small).toEqual([]);
  });

  test("holds still under reduced motion", async ({ page }) => {
    await page.emulateMedia({ reducedMotion: "reduce" });
    await open(page);
    const moving = await page.evaluate(() =>
      Array.from(document.querySelectorAll<HTMLElement>("body *"))
        .filter((element) => {
          const style = getComputedStyle(element);
          const animated = style.animationName !== "none";
          const transitions = style.transitionProperty !== "none" && style.transitionDuration.split(",").some((d) => Number.parseFloat(d) > 0);
          return animated || transitions;
        })
        .map((element) => element.outerHTML.slice(0, 80)),
    );
    expect(moving).toEqual([]);
  });

  test("otherwise animates nothing but colour on hover and focus, and the loading mark", async ({ page }) => {
    await open(page);
    const result = await page.evaluate(() => {
      const geometry = /(^|,\s*)(all|transform|translate|scale|rotate|opacity|width|height|top|left|margin|padding|inset)\b/;
      const elements = Array.from(document.querySelectorAll<HTMLElement>("body *"));
      return {
        animated: elements
          .filter((element) => getComputedStyle(element).animationName !== "none")
          .filter((element) => !(element.hasAttribute("data-spinner") && element.closest("[aria-busy=true]")))
          .map((element) => element.outerHTML.slice(0, 80)),
        moving: elements
          .filter((element) => {
            const style = getComputedStyle(element);
            const timed = style.transitionDuration.split(",").some((duration) => Number.parseFloat(duration) > 0);
            return timed && geometry.test(style.transitionProperty);
          })
          .map((element) => `${getComputedStyle(element).transitionProperty} ${element.outerHTML.slice(0, 60)}`),
      };
    });
    expect(result).toEqual({ animated: [], moving: [] });
  });

  test("works as a hydrated island", async ({ page }) => {
    await open(page);
    const island = page.locator("[data-interactive]");

    const useful = island.getByRole("button", { name: /^Useful/ });
    await expect(useful).toHaveAttribute("aria-pressed", "false");
    await useful.click();
    await expect(useful).toHaveAttribute("aria-pressed", "true");
    await expect(useful).toHaveAccessibleName(/^Useful ?, 7 people$/);

    const decided = island.getByRole("button", { name: /^Decided/ });
    await decided.click();
    await expect(decided).toHaveAttribute("aria-pressed", "true");
    await expect(island.getByRole("button", { name: /^Needs a decision/ })).toHaveAttribute("aria-pressed", "false");

    const pin = island.getByRole("button", { name: "Pin this message" });
    await pin.click();
    await expect(pin).toHaveAttribute("aria-pressed", "true");

    const send = island.getByRole("button", { name: /^Send/ });
    await send.click();
    await expect(send).toHaveAttribute("aria-busy", "true");
    await expect(send).toBeFocused();
    await expect(island.locator("output")).toHaveText("Sent 1 time.");
    await expect(send).not.toHaveAttribute("aria-busy");
  });

  test("records the personas at phone and desktop size", async ({ page }, testInfo) => {
    test.skip(isMobile(testInfo), "One recording run covers both sizes.");
    for (const [size, viewport] of [
      ["390x844", { width: 390, height: 844 }],
      ["1440x900", { width: 1440, height: 900 }],
    ] as const) {
      await page.setViewportSize(viewport);
      await open(page);
      for (const persona of PERSONAS) {
        const path = `${EVIDENCE_DIR}/${size}-${persona}.png`;
        await page.locator(`[data-persona=${persona}]`).screenshot({ path, animations: "disabled" });
        await testInfo.attach(`${size}-${persona}`, { path, contentType: "image/png" });
      }
      await page.screenshot({ path: `${EVIDENCE_DIR}/${size}-full.png`, fullPage: true, animations: "disabled" });
    }
  });
});

/** RGB triples of a PNG, decoded by the browser rather than a dependency. */
async function decode(page: Page, png: Buffer): Promise<[number, number, number][]> {
  return page.evaluate(async (base64) => {
    const image = new Image();
    image.src = `data:image/png;base64,${base64}`;
    await image.decode();
    const canvas = document.createElement("canvas");
    canvas.width = image.width;
    canvas.height = image.height;
    const context = canvas.getContext("2d")!;
    context.drawImage(image, 0, 0);
    const data = context.getImageData(0, 0, image.width, image.height).data;
    const pixels: [number, number, number][] = [];
    for (let index = 0; index < data.length; index += 4) pixels.push([data[index], data[index + 1], data[index + 2]]);
    return pixels;
  }, png.toString("base64"));
}
