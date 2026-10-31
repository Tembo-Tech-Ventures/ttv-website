import { feedbackApiRequest as safeApiRequest } from "../scripts/cloudflare/feedback-browser-guard.mjs";
import { expect, test } from "@playwright/test";
import { mkdirSync } from "fs";

const EVIDENCE_DIR = "test-results/evidence";
mkdirSync(EVIDENCE_DIR, { recursive: true });

const evidence = (name: string) =>
  `${EVIDENCE_DIR}/${test.info().project.name}-${name}.png`;

interface BetterAuthSession {
  user?: {
    name?: string | null;
  };
}

test.describe("authenticated dashboard greeting", () => {
  const token = process.env.PLAYWRIGHT_AGENT_TOKEN;
  test.skip(!token, "No agent bearer token is configured for this environment.");
  test.use({
    extraHTTPHeaders: token ? { Authorization: `Bearer ${token}` } : {},
  });

  test("uses the user's first name only on a return visit", async ({ page, baseURL }) => {
    const sessionResponse = await safeApiRequest(page.request, baseURL!, "/api/auth/get-session");
    expect(sessionResponse.ok()).toBe(true);
    const session = (await sessionResponse.json()) as BetterAuthSession | null;
    const fullName = session?.user?.name?.trim();
    if (!fullName) {
      throw new Error("Authenticated test session did not include a user name.");
    }

    const firstName = fullName.split(/\s+/)[0]!;

    await page.goto("/dashboard");
    // The existing dashboard greets with a heading. Inside the spaces shell the
    // Cohort overview's heading is the page's name, and the greeting is a line under it.
    const inSpaces = (await page.locator(".spaces-shell").count()) > 0;
    const greeting = (name: string) =>
      inSpaces
        ? page.locator("#spaces-main").getByText(`Welcome back, ${name}`, { exact: true })
        : page.getByRole("heading", { name: `Welcome back, ${name}` });
    await expect(greeting(firstName)).toHaveCount(0);

    await page.reload();

    await expect(greeting(firstName)).toBeVisible();
    if (fullName !== firstName) {
      await expect(greeting(fullName)).toHaveCount(0);
    }

    await page.screenshot({
      path: evidence("dashboard-greeting"),
      fullPage: true,
    });
  });
});
