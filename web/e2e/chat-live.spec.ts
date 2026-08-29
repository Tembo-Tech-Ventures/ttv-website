import { expect, test } from "@playwright/test";
import { mkdirSync } from "fs";

/**
 * The layout contract, checked against the real authenticated route.
 *
 * `chat-page.spec.ts` proves the same things far more thoroughly, but only
 * against `/dev/chat-ui` on a local dev server. That page renders the same
 * components, so it cannot catch anything that goes wrong on the way to them —
 * a layout that only misbehaves once middleware, auth and a real session list
 * are involved, or a route that stopped resolving at all. This suite is
 * deliberately thin and only asserts what would make the page unusable.
 */
const EVIDENCE_DIR = "test-results/evidence";
mkdirSync(EVIDENCE_DIR, { recursive: true });

test.describe("authenticated Ask AI page", () => {
  const token = process.env.PLAYWRIGHT_AGENT_TOKEN;
  test.skip(!token, "No agent bearer token is configured for this environment.");
  test.use({
    extraHTTPHeaders: token ? { Authorization: `Bearer ${token}` } : {},
  });

  test("fills the viewport with a composer that needs no scrolling to reach", async ({
    page,
  }, testInfo) => {
    await page.goto("/dashboard/ask");

    const composer = page.getByPlaceholder("Ask about your sessions…");
    await expect(composer).toBeVisible();
    await expect(composer).toBeInViewport();
    await expect(page.getByRole("button", { name: "Send message" })).toBeVisible();

    // The whole point of the route: the document does not scroll.
    const overflow = await page.evaluate(() => {
      const root = document.scrollingElement ?? document.documentElement;
      return root.scrollHeight - root.clientHeight;
    });
    expect(overflow).toBeLessThanOrEqual(1);

    // And the dashboard shell is genuinely gone, not merely hidden.
    await expect(page.getByRole("button", { name: "Open navigation" })).toHaveCount(0);

    await page.screenshot({
      path: `${EVIDENCE_DIR}/${testInfo.project.name}-ask-live.png`,
    });
  });

  test("keeps a signed-in user's way back into the dashboard", async ({ page }, testInfo) => {
    await page.goto("/dashboard/ask");

    // Mobile puts this in the header; desktop puts it at the top of the rail.
    await expect(page.getByRole("link", { name: /Back to dashboard/ })).toBeVisible();

    // Dropping DashboardLayout must not strand anyone without a sign-out. On a
    // phone that lives in the conversation sheet, so open it to check.
    if (testInfo.project.name.includes("mobile")) {
      await page.locator("h1 button").click();
      await expect(page.getByRole("dialog")).toBeVisible();
    }
    await expect(page.getByRole("link", { name: "Logout" })).toBeVisible();
  });
});
