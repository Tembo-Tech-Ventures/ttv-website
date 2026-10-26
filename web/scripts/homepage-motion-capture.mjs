import process from "node:process";
import console from "node:console";
import { chromium } from "@playwright/test";
import { mkdir, writeFile } from "node:fs/promises";

// Public, unauthenticated visual evidence. Run against the local component
// harness or the exact staging deployment; the manifest identifies which.
const url = process.argv[2] ?? "http://127.0.0.1:4322/homepage-values.html";
const directory = process.argv[3] ?? "/tmp/ttv-homepage-motion";
await mkdir(directory, { recursive: true });
const browser = await chromium.launch();
const evidence = [];
try {
  for (const width of [390, 1440]) {
    const context = await browser.newContext({ viewport: { width, height: 900 }, recordVideo: { dir: directory, size: { width, height: 900 } } });
    const page = await context.newPage();
    const errors = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await page.goto(url, { waitUntil: "domcontentloaded" });
    const started = Date.now();
    const frames = [];
    for (const frame of [0, 200, 450, 750, 1150, 1700]) {
      await page.waitForTimeout(Math.max(0, frame - (Date.now() - started)));
      frames.push({ elapsed: Date.now() - started, transforms: await page.locator(".home-wordmark-line > span").evaluateAll((elements) => elements.map((element) => globalThis.getComputedStyle(element).transform)) });
      await page.screenshot({ path: `${directory}/${width}-load-${frame}.png` });
    }
    await page.evaluate(() => globalThis.document.fonts.ready);
    const top = await page.locator(".home-evidence").evaluate((element) => element.getBoundingClientRect().top + globalThis.scrollY);
    for (const step of [0, 1, 2, 3, 4]) {
      await page.evaluate((y) => globalThis.scrollTo({ top: y, behavior: "instant" }), top - 850 + step * 150);
      await page.waitForTimeout(180);
      await page.screenshot({ path: `${directory}/${width}-scroll-${step}.png` });
    }
    await page.locator("#what-we-do").scrollIntoViewIfNeeded();
    await page.waitForTimeout(1000);
    await page.screenshot({ path: `${directory}/${width}-story.png` });
    if (width === 1440) {
      await page.locator('[data-home-stage="mentor"]').hover();
      for (const delay of [80, 350]) {
        await page.waitForTimeout(delay);
        await page.screenshot({ path: `${directory}/${width}-hover-${delay}.png` });
      }
      await page.locator('[data-home-stage="question"]').focus();
      await page.waitForTimeout(400);
      await page.screenshot({ path: `${directory}/${width}-focus.png` });
    }
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.mouse.move(0, 0);
    await page.evaluate(() => { if (globalThis.document.activeElement instanceof globalThis.HTMLElement) globalThis.document.activeElement.blur(); });
    await page.evaluate(() => globalThis.scrollTo(0, 0));
    await page.screenshot({ path: `${directory}/${width}-reduced.png` });
    const video = page.video();
    evidence.push({ url, width, errors, frames, video: video ? await video.path() : null });
    await context.close();
  }
} finally { await browser.close(); }
await writeFile(`${directory}/manifest.json`, JSON.stringify(evidence, null, 2));
console.log(`Captured screenshots, running-animation frames and videos in ${directory}`);
