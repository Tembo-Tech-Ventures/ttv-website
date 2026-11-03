// PERF-1 (investigation branch only): medians per step from test-results/perf/*.json, as Markdown.
// Usage: node scripts/perf/summarize.mjs [dir] > summary.md
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";

const dir = process.argv[2] ?? "test-results/perf";
const rows = readdirSync(dir).filter(f => f.endsWith(".json")).flatMap(f => JSON.parse(readFileSync(path.join(dir, f), "utf8")));
const median = values => {
  const v = values.filter(x => typeof x === "number").toSorted((a, b) => a - b);
  return v.length > 0 ? v[Math.floor((v.length - 1) / 2)] : null;
};
const groups = new Map();
for (const row of rows) {
  const key = [row.profile, row.variant, row.journey].join(" · ");
  if (!groups.has(key)) groups.set(key, new Map());
  const steps = groups.get(key);
  if (!steps.has(row.step)) steps.set(row.step, []);
  steps.get(row.step).push(row);
}
const kb = n => n === null || n === undefined ? "" : Math.round(n / 1024);
for (const [key, steps] of groups) {
  console.log(`\n### ${key}\n`);
  console.log("| step | n | via | click→visible | click→shell ready | TTFB | FCP | LCP | shell hydrated | JS files | JS KB (transfer/decoded) | main-thread script ms | D1 queries | D1 waves | server headers ms |");
  console.log("|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|");
  for (const [step, list] of steps) {
    const m = f => median(list.map(f));
    console.log(`| ${step} | ${list.length} | ${list[0].via}${list[0].hard ? "" : " (soft)"} | ${m(r => r.clickToVisibleMs)} | ${m(r => r.clickToReadyMs)} | ${m(r => r.doc?.ttfb) ?? ""} | ${m(r => r.doc?.fcp) ?? ""} | ${m(r => r.doc?.lcp) ?? ""} | ${m(r => r.doc?.shellHydrated) ?? ""} | ${m(r => r.js?.count)} | ${kb(m(r => r.js?.transfer))}/${kb(m(r => r.js?.decoded))} | ${m(r => r.scriptMs)} | ${m(r => r.server?.d1) ?? ""} | ${m(r => r.server?.waves) ?? ""} | ${m(r => r.server?.headersMs) ?? ""} |`);
  }
}
