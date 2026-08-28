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

  test("uses the user's first name", async ({ page }) => {
    const sessionResponse = await page.request.get("/api/auth/get-session");
    expect(sessionResponse.ok()).toBe(true);
    const session = (await sessionResponse.json()) as BetterAuthSession | null;
    const fullName = session?.user?.name?.trim();
    if (!fullName) {
      throw new Error("Authenticated test session did not include a user name.");
    }

    const firstName = fullName.split(/\s+/)[0]!;

    await page.goto("/dashboard");

    await expect(
      page.getByRole("heading", { name: `Welcome back, ${firstName}` })
    ).toBeVisible();
    if (fullName !== firstName) {
      await expect(
        page.getByRole("heading", { name: `Welcome back, ${fullName}` })
      ).toHaveCount(0);
    }

    await page.screenshot({
      path: evidence("dashboard-greeting"),
      fullPage: true,
    });
  });
});
