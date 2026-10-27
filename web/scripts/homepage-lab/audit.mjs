#!/usr/bin/env node
// Walks a homepage candidate like a visitor at several viewports, saving
// viewport frames (including short motion bursts right after each scroll) and
// a contact sheet, and reports any text that is never fully readable.
//
//   node scripts/homepage-lab/audit.mjs --path /preview/home/a --out ../.homepage-lab/a/r1
//   options: --viewports phone,laptop  --reduced  --no-frames  --settle 450
import { execFileSync } from "node:child_process";
import { mkdirSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { parseArgs } from "node:util";
import { installTextTracker, sampleText, sweepHorizontalScrollers, textReport } from "../../e2e/text-integrity.ts";
import { VIEWPORTS, gotoReady, openLab } from "./lab.mjs";

const { values } = parseArgs({
  options: {
    path: { type: "string" },
    out: { type: "string" },
    viewports: { type: "string", default: "phone,tablet,laptop,wide" },
    reduced: { type: "boolean", default: false },
    "no-frames": { type: "boolean", default: false },
    settle: { type: "string", default: "450" },
    root: { type: "string", default: "main" },
  },
});

if (!values.path || !values.out) {
  console.error("usage: audit.mjs --path <route> --out <dir> [--viewports phone,laptop] [--reduced]");
  process.exit(2);
}

const settleMs = Number(values.settle);
const frames = !values["no-frames"];
const summary = { path: values.path, reducedMotion: values.reduced, viewports: {} };

for (const name of values.viewports.split(",")) {
  if (!VIEWPORTS[name]) throw new Error(`unknown viewport ${name}`);
  const dir = path.resolve(values.out, values.reduced ? `${name}-reduced` : name);
  rmSync(dir, { recursive: true, force: true });
  mkdirSync(dir, { recursive: true });
  const { browser, page, errors } = await openLab({ viewport: name, reducedMotion: values.reduced ? "reduce" : "no-preference" });
  try {
    const response = await gotoReady(page, values.path);
    if (!response?.ok()) throw new Error(`${values.path} answered ${response?.status()}`);
    await installTextTracker(page, values.root);
    const viewport = VIEWPORTS[name];
    let frame = 0;
    const shot = async (label) => {
      if (!frames) return;
      frame += 1;
      await page.screenshot({ path: path.join(dir, `${String(frame).padStart(3, "0")}-${label}.jpg`), type: "jpeg", quality: 72 });
    };
    await page.waitForTimeout(1600); // let the intro play out
    await sampleText(page);
    await shot("intro");
    let still = 0;
    for (let step = 0; step < 300 && still < 3; step += 1) {
      const before = await page.evaluate(() => window.scrollY);
      await page.mouse.move(viewport.width / 2, viewport.height / 2);
      await page.mouse.wheel(0, Math.round(viewport.height * 0.45));
      if (frames && step % 2 === 0) {
        await page.waitForTimeout(90);
        await shot(`s${step}-motion`);
      }
      await page.waitForTimeout(settleMs);
      await sampleText(page);
      await sweepHorizontalScrollers(page);
      const after = await page.evaluate(() => window.scrollY);
      still = Math.abs(after - before) < 2 ? still + 1 : 0;
      if (still === 0) await shot(`s${step}`);
    }
    await page.waitForTimeout(settleMs);
    await sampleText(page);
    const report = await textReport(page);
    const pageHeight = await page.evaluate(() => document.documentElement.scrollHeight);
    summary.viewports[name] = {
      checked: report.checked,
      problems: report.issues.filter((issue) => !issue.decorative),
      decorative: report.issues.filter((issue) => issue.decorative),
      maxHorizontalOverflow: report.maxHorizontalOverflow,
      pageHeight,
      consoleErrors: errors,
    };
    if (frames) {
      const settled = readdirSync(dir).filter((file) => !file.includes("motion")).toSorted();
      const columns = viewport.width < 600 ? 6 : 4;
      const rows = Math.ceil(settled.length / columns);
      const listFile = path.join(dir, "frames.txt");
      writeFileSync(listFile, settled.map((file) => `file '${path.join(dir, file)}'`).join("\n"));
      execFileSync("ffmpeg", [
        "-loglevel", "error", "-y", "-f", "concat", "-safe", "0", "-i", listFile,
        "-vf", `scale=${viewport.width < 600 ? 260 : 480}:-1,tile=${columns}x${rows}:padding=6:color=0x222222`,
        "-frames:v", "1", "-q:v", "4", path.join(values.out, `${values.reduced ? `${name}-reduced` : name}-contact.jpg`),
      ]);
      rmSync(listFile);
    }
  } finally {
    await browser.close();
  }
}

writeFileSync(path.resolve(values.out, `report${values.reduced ? "-reduced" : ""}.json`), JSON.stringify(summary, null, 2));
let failing = 0;
for (const [name, result] of Object.entries(summary.viewports)) {
  const status = result.problems.length > 0 || result.maxHorizontalOverflow > 1 ? "FAIL" : "ok";
  if (status === "FAIL") failing += 1;
  console.log(`${status.padEnd(4)} ${name.padEnd(7)} text=${result.checked} unreadable=${result.problems.length} decorative=${result.decorative.length} overflowX=${result.maxHorizontalOverflow}px height=${result.pageHeight}px errors=${result.consoleErrors.length}`);
  for (const problem of result.problems.slice(0, 12)) console.log(`       - "${problem.text}" — ${problem.reason} (${problem.path})`);
  for (const error of result.consoleErrors.slice(0, 5)) console.log(`       ! ${error.slice(0, 200)}`);
}
process.exit(failing ? 1 : 0);
