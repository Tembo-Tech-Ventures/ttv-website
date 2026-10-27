import { expect, test } from "@playwright/test";
import { VALUES } from "../src/components/homepage/values";
import { SECTION_ORDER } from "../src/lib/homepage/content";
import { installTextTracker, textReport, walkAndSample } from "./text-integrity";

/**
 * Contract for every homepage design candidate: the same sections in the same
 * order, the five principles all present, and not one word that a visitor
 * cannot read at some point while scrolling — at phone and desktop sizes, with
 * and without reduced motion. Static content only, so it runs against local
 * dev servers and deployed previews alike.
 */
const CANDIDATES = ["/preview/home/a", "/preview/home/b", "/preview/home/c", "/preview/home/d"];

for (const path of CANDIDATES) {
  test.describe(path, () => {
    test.setTimeout(240_000);

    test("keeps the agreed section order and all five principles", async ({ page }) => {
      await page.goto(path);
      const tops: number[] = [];
      for (const id of SECTION_ORDER) {
        const section = page.locator(`main #${id}`);
        await expect(section, `#${id} is missing`).toHaveCount(1);
        tops.push(await section.evaluate((el) => el.getBoundingClientRect().top + window.scrollY));
      }
      expect(tops).toEqual(tops.toSorted((a, b) => a - b));
      const principles = page.locator("main #principles");
      for (const value of VALUES) {
        await expect(principles.getByText(value.word, { exact: true }).first()).toBeAttached();
        await expect(principles.getByText(value.commitment, { exact: true }).first()).toBeAttached();
      }
      await expect(page.locator("main h1")).toHaveCount(1);
    });

    test("keyboard users can reach every link and button without scrolling first", async ({ page }) => {
      await page.goto(path);
      await page.evaluate(() => document.fonts.ready);
      await page.waitForTimeout(1200);
      // Reveal animations that park content at visibility:hidden make it
      // unfocusable, so Tab would jump from the hero straight to the footer.
      const expected = await page.evaluate(() => {
        const selector = "a[href], button:not([disabled]), input, select, textarea, [tabindex]:not([tabindex='-1'])";
        return [...document.querySelectorAll<HTMLElement>(`main :is(${selector})`)]
          .filter((el) => el.getAttribute("tabindex") !== "-1" && el.checkVisibility() && !el.closest("[inert], [aria-hidden='true']"))
          .map((el, index) => {
            el.dataset.tabProbe = String(index);
            return `${el.tagName.toLowerCase()} "${(el.textContent ?? "").trim().replace(/\s+/g, " ").slice(0, 40)}"`;
          });
      });
      expect(expected.length).toBeGreaterThan(5);
      const reached = new Set<string>();
      for (let presses = 0; presses < expected.length + 40; presses += 1) {
        await page.keyboard.press("Tab");
        const probe = await page.evaluate(() => {
          const active = document.activeElement as HTMLElement | null;
          return { probe: active?.dataset.tabProbe ?? null, inFooter: Boolean(active?.closest("footer")) };
        });
        if (probe.probe !== null) reached.add(probe.probe);
        if (probe.inFooter) break;
      }
      const missed = expected.filter((_, index) => !reached.has(String(index)));
      expect(missed, "never reached by Tab").toEqual([]);
    });

    test("every section anchor lands on its heading, jumping down or back up", async ({ page }) => {
      await page.goto(path);
      await page.evaluate(() => document.fonts.ready);
      const jumps = [
        ...SECTION_ORDER.slice(1).map((id) => ({ id, from: "top" })),
        ...[...SECTION_ORDER].toReversed().map((id) => ({ id, from: "bottom" })),
      ];
      for (const { id, from } of jumps) {
        await page.evaluate((start) => {
          window.history.replaceState(null, "", window.location.pathname);
          window.scrollTo(0, start === "top" ? 0 : document.documentElement.scrollHeight);
        }, from);
        await page.waitForTimeout(400);
        await page.evaluate((target) => { window.location.hash = target; }, id);
        await page.waitForTimeout(900);
        const landing = await page.evaluate((target) => {
          const heading = document.querySelector(`main #${target}`)?.querySelector("h1, h2");
          if (!heading) return "no heading";
          const box = heading.getBoundingClientRect();
          if (box.top < 0 || box.top > window.innerHeight * 0.6) return `heading at ${Math.round(box.top)}px`;
          const hit = document.elementFromPoint(Math.min(box.left + 8, window.innerWidth - 1), box.top + box.height / 2);
          return hit && (heading.contains(hit) || hit.contains(heading)) ? "ok" : `heading covered by <${hit?.tagName.toLowerCase()}>`;
        }, id);
        expect(landing, `#${id} from the ${from}`).toBe("ok");
      }
    });

    for (const reducedMotion of ["no-preference", "reduce"] as const) {
      test(`every word is readable while scrolling (motion: ${reducedMotion})`, async ({ page }) => {
        const errors: string[] = [];
        page.on("pageerror", (error) => errors.push(error.message));
        await page.emulateMedia({ reducedMotion });
        await page.goto(path);
        await page.evaluate(() => document.fonts.ready);
        await page.waitForTimeout(1200);
        await installTextTracker(page, "main");
        await walkAndSample(page);
        const report = await textReport(page);
        const unreadable = report.issues.filter((issue) => !issue.decorative);
        expect(unreadable, JSON.stringify(unreadable, null, 2)).toEqual([]);
        expect(report.maxHorizontalOverflow).toBeLessThanOrEqual(1);
        expect(errors).toEqual([]);
      });
    }
  });
}
