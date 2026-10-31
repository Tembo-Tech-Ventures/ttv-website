import { createHash } from "node:crypto";
import { expect, type Page, type TestInfo } from "@playwright/test";

/** axe-core, pinned by hash, for the platform specs' WCAG checks. */
const AXE_URL = "https://cdn.jsdelivr.net/npm/axe-core@4.10.3/axe.min.js";
const AXE_SHA384 = "17w4i/EfU4m8vRTTBQs69gAb/fjBpQi0/OOcQTspZXbRlDA0OcGoZX3ZUxQpgTYL";
const WCAG_AA = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"];

let source: Promise<string> | null = null;

function axeSource(): Promise<string> {
  source ??= fetch(AXE_URL).then(async (response) => {
    const body = Buffer.from(await response.arrayBuffer());
    expect(createHash("sha384").update(body).digest("base64")).toBe(AXE_SHA384);
    return body.toString("utf8");
  });
  return source;
}

/** Runs axe at WCAG 2.2 A and AA and fails on any violation. Incomplete checks are attached for review. */
export async function runAxe(page: Page, testInfo: TestInfo, name: string): Promise<void> {
  const script = await axeSource();
  // Evaluated rather than injected as a tag, so a deployed page's CSP cannot block it.
  if (!(await page.evaluate(() => "axe" in window))) await page.evaluate(script);
  const result = await page.evaluate(async (tags) => {
    type Run = { violations: { id: string; nodes: { target: string[] }[] }[]; incomplete: { id: string; nodes: unknown[] }[] };
    const { axe } = window as unknown as { axe: { run: (context: unknown, options: unknown) => Promise<Run> } };
    const run = await axe.run({ exclude: [["astro-dev-toolbar"]] }, { runOnly: { type: "tag", values: tags } });
    return {
      violations: run.violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(" ")).slice(0, 3).join(", ")}`),
      incomplete: run.incomplete.map((v) => `${v.id} × ${v.nodes.length}`),
    };
  }, WCAG_AA);
  await testInfo.attach(`axe-incomplete-${name}`, { body: result.incomplete.join("\n") || "none", contentType: "text/plain" });
  expect(result.violations, name).toEqual([]);
}
