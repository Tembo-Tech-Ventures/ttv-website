import { chromium, type FullConfig } from "@playwright/test";

const REQUIRED_CONSECUTIVE = 6;
const POLL_INTERVAL_MS = 3_000;
const BUDGET_MS = 4 * 60_000;

/**
 * Freshly created workers.dev subdomains propagate eventually-consistently,
 * and the Cloudflare placeholder page can reappear minutes after node-level
 * smoke checks pass because the browser's network path may reach different
 * edge nodes than Node's fetch. Before any test runs, poll the health
 * endpoint through a real Chromium page until it answers consistently, so
 * the suite starts only once the deployment is stable on the path the tests
 * actually use.
 */
export default async function globalSetup(config: FullConfig) {
  const baseURL = process.env.PLAYWRIGHT_BASE_URL;
  if (!baseURL) return; // local dev-server runs skip the live-stability gate

  const healthUrl = new URL("/api/health", baseURL).toString();
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage();
    const deadline = Date.now() + BUDGET_MS;
    let consecutive = 0;
    let lastProblem = "no responses yet";

    while (Date.now() < deadline) {
      try {
        const response = await page.goto(healthUrl, { timeout: 15_000 });
        const body = await response?.text();
        const parsed = body ? (JSON.parse(body) as { status?: string }) : null;
        if (response?.ok() && parsed?.status === "ok") {
          consecutive += 1;
          if (consecutive >= REQUIRED_CONSECUTIVE) return;
        } else {
          consecutive = 0;
          lastProblem = `HTTP ${response?.status()} body ${body?.slice(0, 80)}`;
        }
      } catch (error) {
        consecutive = 0;
        lastProblem = error instanceof Error ? error.message : String(error);
      }
      await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));
    }

    throw new Error(
      `Deployment at ${healthUrl} never stayed stable for ${REQUIRED_CONSECUTIVE} consecutive browser checks (last problem: ${lastProblem}).`
    );
  } finally {
    await browser.close();
  }
}
