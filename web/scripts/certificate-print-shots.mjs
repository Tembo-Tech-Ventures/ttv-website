#!/usr/bin/env node
/**
 * Renders the certificate print prototypes the way a printer sees them.
 *
 * Emulating `media: print` and taking a viewport screenshot is not the same
 * thing as printing: it ignores `@page`, silently drops pagination, and hides
 * the exact failure this script exists to catch — a one-page credential that
 * quietly spills onto a second sheet. So each variant goes through Chromium's
 * real print path to PDF, gets rasterised with poppler, and is rejected if it
 * did not come out as exactly one page.
 *
 * Requires a dev server (`npm run dev`) and poppler-utils on PATH.
 *
 *   node scripts/certificate-print-shots.mjs [--out DIR] [--base URL]
 */
import { chromium } from "@playwright/test";
import { execFileSync } from "node:child_process";
import { mkdirSync, readdirSync, rmSync } from "node:fs";
import { join } from "node:path";

const VARIANTS = [
  { key: "current", label: "baseline-as-shipped" },
  { key: "a", label: "a-one-artefact" },
  { key: "b", label: "b-landscape-diploma" },
  { key: "c", label: "c-ink-light-portrait" },
];

/** Both papers, because "it fits" on one says nothing about the other. */
const PAPERS = [
  { key: "letter", format: "Letter" },
  { key: "a4", format: "A4" },
];

/*
 * "Background graphics" is OFF in Chrome's print dialog unless the user goes
 * looking for it, so the no-backgrounds render is the one most recipients will
 * actually get. A design whose brand colour only survives the opt-in render
 * has not solved printing; `print-color-adjust: exact` is what makes an
 * element ignore this setting, and this axis is how that claim gets checked
 * rather than asserted.
 */
const BACKGROUNDS = [
  { key: "bg-on", printBackground: true },
  { key: "bg-off", printBackground: false },
];

const RASTER_DPI = 150;

function arg(name, fallback) {
  const index = process.argv.indexOf(`--${name}`);
  return index === -1 ? fallback : process.argv[index + 1];
}

const baseUrl = arg("base", process.env.PLAYWRIGHT_BASE_URL ?? "http://127.0.0.1:4321");
const outDir = arg("out", "test-results/certificate-print");

function pdfPageCount(pdfPath) {
  const info = execFileSync("pdfinfo", [pdfPath], { encoding: "utf8" });
  const match = info.match(/^Pages:\s+(\d+)$/m);
  if (!match) throw new Error(`pdfinfo gave no page count for ${pdfPath}`);
  return Number(match[1]);
}

/** poppler writes `<prefix>-1.png`; normalise it back to `<prefix>.png`. */
function rasterise(pdfPath, pngPath) {
  const prefix = pngPath.replace(/\.png$/, "");
  execFileSync("pdftoppm", [
    "-png",
    "-r",
    String(RASTER_DPI),
    "-f",
    "1",
    "-l",
    "1",
    pdfPath,
    prefix,
  ]);
  const produced = readdirSync(outDir).find((name) =>
    name.startsWith(`${prefix.split("/").pop()}-`)
  );
  if (!produced) throw new Error(`pdftoppm produced nothing for ${pdfPath}`);
  execFileSync("mv", [join(outDir, produced), pngPath]);
}

rmSync(outDir, { recursive: true, force: true });
mkdirSync(outDir, { recursive: true });

const browser = await chromium.launch();
const page = await browser.newPage();
const failures = [];

for (const variant of VARIANTS) {
  const url = `${baseUrl}/dev/certificate-print/${variant.key}`;
  const response = await page.goto(url, { waitUntil: "networkidle" });
  if (!response?.ok()) {
    failures.push(`${url} returned ${response?.status()}`);
    continue;
  }
  // Webfonts are what the whole layout is measured in; screenshotting the
  // fallback face would make every spacing judgement below meaningless.
  await page.evaluate(() => document.fonts.ready);

  for (const paper of PAPERS) {
    for (const background of BACKGROUNDS) {
      const stem = `${variant.label}-${paper.key}-${background.key}`;
      const pdfPath = join(outDir, `${stem}.pdf`);
      const pngPath = join(outDir, `${stem}.png`);

      await page.pdf({
        path: pdfPath,
        format: paper.format,
        printBackground: background.printBackground,
        // Honour the `@page` rule (orientation, margins), don't override it.
        preferCSSPageSize: true,
      });

      const pages = pdfPageCount(pdfPath);
      if (pages !== 1) {
        failures.push(`${stem}: ${pages} pages, expected 1`);
      }
      rasterise(pdfPath, pngPath);
      console.log(`${stem}: ${pages} page(s) -> ${pngPath}`);
    }
  }
}

await browser.close();

if (failures.length > 0) {
  console.error(`\n${failures.length} problem(s):`);
  for (const failure of failures) console.error(`  - ${failure}`);
  process.exit(1);
}
console.log(`\nAll variants rendered to ${outDir}`);
