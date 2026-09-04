/**
 * Screenshots of the post editor, taken from the real component.
 *
 * Points a browser at `/dev/writing-ui`, which renders the shipped `PostEditor`
 * in the shipped layout with fixed data. Mock-ups of a UI are worth very little
 * for reviewing one — they show what someone intended rather than what the code
 * does — so this drives the actual editor, including the interactions that only
 * exist at runtime: the selection toolbar, the block menu, the settings panel.
 *
 *   node scripts/writing-ui-shots.mjs [outputDir]
 *
 * Requires `npm run dev` to be running on port 4321.
 */
import { chromium } from "@playwright/test";
import { mkdirSync } from "node:fs";

const BASE = process.env.PLAYWRIGHT_BASE_URL ?? "http://127.0.0.1:4321";
const OUT = process.argv[2] ?? "/tmp/writing-shots";

mkdirSync(OUT, { recursive: true });

const browser = await chromium.launch({ args: ["--no-sandbox"] });

/** Waits for the editor to have hydrated and imported its Markdown. */
async function openEditor(page, path) {
  await page.goto(`${BASE}${path}`, { waitUntil: "networkidle" });
  await page.waitForSelector("[data-post-body]");
  // Hydration swaps the canvas; without settling here the first shot catches a
  // half-mounted editor and every review comment is about a bug that is not
  // there.
  await page.waitForTimeout(600);
}

async function shot(page, name) {
  await page.screenshot({ path: `${OUT}/${name}.png` });
  console.log(`${OUT}/${name}.png`);
}

async function desktop(name, path, action) {
  const context = await browser.newContext({
    viewport: { width: 1440, height: 900 },
    deviceScaleFactor: 2,
  });
  const page = await context.newPage();
  await openEditor(page, path);
  if (action) await action(page);
  await shot(page, name);
  await context.close();
}

async function mobile(name, path, action) {
  const context = await browser.newContext({
    viewport: { width: 390, height: 844 },
    deviceScaleFactor: 3,
    isMobile: true,
    hasTouch: true,
  });
  const page = await context.newPage();
  await openEditor(page, path);
  if (action) await action(page);
  await shot(page, name);
  await context.close();
}

/** Selects a phrase in the body so the floating toolbar has something to sit on. */
async function selectPhrase(page, phrase) {
  await page.evaluate((needle) => {
    const body = document.querySelector("[data-post-body]");
    const walker = document.createTreeWalker(body, NodeFilter.SHOW_TEXT);
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      const index = node.textContent.indexOf(needle);
      if (index === -1) continue;
      const range = document.createRange();
      range.setStart(node, index);
      range.setEnd(node, index + needle.length);
      const selection = window.getSelection();
      selection.removeAllRanges();
      selection.addRange(range);
      return;
    }
    throw new Error(`No text node contains ${JSON.stringify(needle)}`);
  }, phrase);
  await page.mouse.move(400, 400);
  await page.mouse.up();
  await page.waitForSelector('[role="toolbar"][aria-label="Text formatting"]');
}

await desktop("01-draft", "/dev/writing-ui?state=draft");
await desktop("02-empty", "/dev/writing-ui?state=empty");
await desktop("03-panel", "/dev/writing-ui?state=published", async (page) => {
  await page.getByRole("button", { name: "Post settings" }).click();
  await page.waitForTimeout(350);
});
await desktop("04-toolbar", "/dev/writing-ui?state=draft", async (page) => {
  await selectPhrase(page, "The spreadsheet is the product");
});
await desktop("05-block-menu", "/dev/writing-ui?state=empty", async (page) => {
  await page.locator("[data-post-body]").click();
  await page.keyboard.type("A first line, then an empty one.");
  await page.keyboard.press("Enter");
  await page.waitForSelector('button[aria-label="Insert block"]');
  await page.getByRole("button", { name: "Insert block" }).first().click();
  await page.waitForTimeout(200);
});
await desktop("06-markdown", "/dev/writing-ui?state=draft", async (page) => {
  await page.getByRole("button", { name: "Edit Markdown" }).click();
  await page.waitForTimeout(200);
});
await mobile("07-mobile-draft", "/dev/writing-ui?state=draft");
await mobile("08-mobile-panel", "/dev/writing-ui?state=published", async (page) => {
  await page.getByRole("button", { name: "Post settings" }).click();
  await page.waitForTimeout(350);
});

await browser.close();
