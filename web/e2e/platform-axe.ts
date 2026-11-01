import { createHash } from "node:crypto";
import { expect, type Page, type TestInfo } from "@playwright/test";

/**
 * axe-core, pinned by hash, for every platform spec's WCAG checks: the one
 * copy CI and local runs both load. 4.14 is the first release that runs
 * label-content-name-mismatch (WCAG 2.5.3, Level A) by default; earlier ones
 * shipped it as experimental and skipped it, which is how the shell's names
 * passed QA-1 (QA1R-01). Do not pin an older release.
 */
export const AXE_VERSION = "4.14.0";
const AXE_URL = `https://cdn.jsdelivr.net/npm/axe-core@${AXE_VERSION}/axe.min.js`;
const AXE_SHA384 = "lFUXB8tI4BaTE1bqxH9eeAXON2NH1qsdAhs7S5L++nUNP5QOy+hwr0C3TYEJUEl0";
const WCAG_AA = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"];
/** Rules that must run under those tags, so a release that drops one fails instead of passing quietly. */
const REQUIRED_RULES = ["label-content-name-mismatch"];

let source: Promise<string> | null = null;

function axeSource(): Promise<string> {
  source ??= fetch(AXE_URL).then(async (response) => {
    const body = Buffer.from(await response.arrayBuffer());
    expect(createHash("sha384").update(body).digest("base64")).toBe(AXE_SHA384);
    return body.toString("utf8");
  });
  return source;
}

type AxeRun = {
  violations: { id: string; nodes: { target: string[] }[] }[];
  incomplete: { id: string; nodes: unknown[] }[];
  rules: string[];
  version: string;
};

export type AxeOptions = {
  /** Only these rules, instead of every WCAG 2.2 A and AA rule. */
  rules?: string[];
  /** Only inside these selectors, instead of the whole page. */
  include?: string[];
};

/** Runs the pinned axe on the page. */
export async function axeRun(page: Page, { rules, include }: AxeOptions = {}): Promise<AxeRun> {
  const script = await axeSource();
  // Evaluated rather than injected as a tag, so a deployed page's CSP cannot block it.
  if (!(await page.evaluate(() => "axe" in window))) await page.evaluate(script);
  return page.evaluate(
    async ({ tags, only, within }) => {
      type Result = { id: string; nodes: { target: string[] }[] };
      type Run = { violations: Result[]; incomplete: Result[]; passes: Result[]; inapplicable: Result[] };
      const { axe } = window as unknown as { axe: { version: string; run: (context: unknown, options: unknown) => Promise<Run> } };
      const runOnly = only ? { type: "rule", values: only } : { type: "tag", values: tags };
      const context = { ...(within ? { include: within.map((selector) => [selector]) } : {}), exclude: [["astro-dev-toolbar"]] };
      const run = await axe.run(context, { runOnly });
      return {
        violations: run.violations,
        incomplete: run.incomplete,
        rules: [...run.violations, ...run.incomplete, ...run.passes, ...run.inapplicable].map((rule) => rule.id),
        version: axe.version,
      };
    },
    { tags: WCAG_AA, only: rules, within: include },
  );
}

export function describeViolations(run: AxeRun): string[] {
  return run.violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(" ")).slice(0, 3).join(", ")}`);
}

/** Runs axe at WCAG 2.2 A and AA and fails on any violation. Incomplete checks are attached for review. */
export async function runAxe(page: Page, testInfo: TestInfo, name: string, { include }: Pick<AxeOptions, "include"> = {}): Promise<void> {
  const run = await axeRun(page, { include });
  expect(run.version, "the pinned axe ran").toBe(AXE_VERSION);
  for (const rule of REQUIRED_RULES) expect(run.rules, `${name}: axe ran ${rule}`).toContain(rule);
  await testInfo.attach(`axe-incomplete-${name}`, {
    body: run.incomplete.map((v) => `${v.id} × ${v.nodes.length}`).join("\n") || "none",
    contentType: "text/plain",
  });
  expect(describeViolations(run), name).toEqual([]);
}
