// Per-step medians and p75s from the navigation harness (e2e/perf), as Markdown. See web/docs/performance.md.
// Usage: node scripts/perf/summarize.mjs <dir> [<baseline dir>]
// With a baseline, each cell reads "baseline → this run".
import { existsSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";

/** Nearest-rank quantile; null when nothing was measured. */
export function quantile(values, q) {
  const sorted = values.filter((value) => typeof value === "number").toSorted((a, b) => a - b);
  return sorted.length > 0 ? sorted[Math.ceil(q * sorted.length) - 1] : null;
}

const COLUMNS = [
  ["click→visible ms", (row) => row.clickToVisibleMs],
  ["TTFB ms", (row) => row.doc?.ttfb],
  ["server ms to headers", (row) => row.server?.headersMs],
  ["D1 queries", (row) => row.server?.d1],
  ["D1 waves", (row) => row.server?.waves],
  ["D1 depth", (row) => row.server?.depth],
];

export function load(dir) {
  if (!existsSync(dir)) return [];
  return readdirSync(dir).filter((file) => file.endsWith(".json"))
    .flatMap((file) => JSON.parse(readFileSync(path.join(dir, file), "utf8")));
}

function groups(rows) {
  const byJourney = new Map();
  for (const row of rows) {
    const key = `${row.profile} · ${row.journey}`;
    if (!byJourney.has(key)) byJourney.set(key, new Map());
    const steps = byJourney.get(key);
    if (!steps.has(row.step)) steps.set(row.step, []);
    steps.get(row.step).push(row);
  }
  return byJourney;
}

const cell = (list, read) => {
  if (!list) return "";
  const median = quantile(list.map(read), 0.5);
  return median === null ? "" : `${median} (${quantile(list.map(read), 0.75)})`;
};

export function summarize(rows, baselineRows = null) {
  const lines = [];
  const baseline = baselineRows ? groups(baselineRows) : null;
  for (const [key, steps] of groups(rows)) {
    lines.push("", `### ${key}`, "", "Median (p75)." + (baseline ? " Baseline → this run." : ""), "");
    lines.push(`| step | n | ${COLUMNS.map(([name]) => name).join(" | ")} |`, `|---|---|${COLUMNS.map(() => "---|").join("")}`);
    for (const [step, list] of steps) {
      const before = baseline?.get(key)?.get(step);
      const cells = COLUMNS.map(([, read]) => baseline ? `${cell(before, read) || "–"} → ${cell(list, read)}` : cell(list, read));
      lines.push(`| ${step} | ${list.length} | ${cells.join(" | ")} |`);
    }
  }
  return lines.join("\n");
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const [dir = "test-results/perf", baselineDir] = process.argv.slice(2);
  console.log(summarize(load(dir), baselineDir ? load(baselineDir) : null));
}
