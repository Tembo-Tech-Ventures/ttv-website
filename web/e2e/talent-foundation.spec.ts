import { expect, test, type Page } from "@playwright/test";
import { mkdirSync } from "fs";

const EVIDENCE_DIR = "test-results/evidence";
mkdirSync(EVIDENCE_DIR, { recursive: true });

// Both Playwright projects run these tests in parallel; the project name in
// the filename keeps their evidence screenshots from clobbering each other.
const evidence = (name: string) =>
  `${EVIDENCE_DIR}/${test.info().project.name}-${name}.png`;


/**
 * Opens the admin navigation on a phone: the Admin space's drawer where the spaces flag is on for
 * this session (T02), the existing admin shell's menu otherwise.
 */
async function openAdminNavigation(page: Page) {
  if ((await page.locator(".spaces-shell").count()) > 0) {
    await page.getByRole("link", { name: /^Open .+ menu$/ }).click();
    await expect(page.locator("#space-sidebar")).toHaveAttribute("role", "dialog");
    return;
  }
  const opener = page.getByRole("button", { name: /open navigation/i });
  await expect(opener).toBeEnabled();
  await opener.click();
  await expect(opener).toHaveAttribute("aria-expanded", "true");
}

test.describe("public talent stubs", () => {
  test("/talent returns 200 with heading", async ({ page }) => {
    const response = await page.goto("/talent");
    expect(response?.status()).toBe(200);
    await expect(
      page.getByRole("heading", { name: /meet our/i }),
    ).toBeVisible();
    await page.screenshot({
      path: evidence("talent-stub"),
      fullPage: true,
    });
  });

  test("/hire returns 200 with heading", async ({ page }) => {
    const response = await page.goto("/hire");
    expect(response?.status()).toBe(200);
    await expect(
      page.getByRole("heading", { name: /work with/i }),
    ).toBeVisible();
    await page.screenshot({
      path: evidence("hire-stub"),
      fullPage: true,
    });
  });
});

test.describe("authenticated talent foundation", () => {
  const token = process.env.PLAYWRIGHT_AGENT_TOKEN;
  test.skip(
    !token,
    "No agent bearer token is configured for this environment.",
  );
  test.use({
    extraHTTPHeaders: token ? { Authorization: `Bearer ${token}` } : {},
  });

  test("dashboard/portfolio stub renders", async ({ page }) => {
    await page.goto("/dashboard/portfolio");
    await expect(
      page.getByRole("heading", { name: /^(portfolio|public profile)$/i }),
    ).toBeVisible();
    await page.screenshot({
      path: evidence("dashboard-portfolio"),
      fullPage: true,
    });
  });

  test("dashboard/leads stub renders", async ({ page }) => {
    await page.goto("/dashboard/leads");
    await expect(page.getByRole("heading", { name: /^(leads|visitor messages)$/i })).toBeVisible();
    await page.screenshot({
      path: evidence("dashboard-leads"),
      fullPage: true,
    });
  });

  test("dashboard/opportunities stub renders", async ({ page }) => {
    await page.goto("/dashboard/opportunities");
    await expect(
      page.getByRole("heading", { name: /opportunities/i }),
    ).toBeVisible();
    await page.screenshot({
      path: evidence("dashboard-opportunities"),
      fullPage: true,
    });
  });

  test("admin/profiles stub renders", async ({ page }) => {
    await page.goto("/admin/profiles");
    await expect(
      page.getByRole("heading", { name: /profiles/i }),
    ).toBeVisible();
    await page.screenshot({
      path: evidence("admin-profiles"),
      fullPage: true,
    });
  });

  test("admin/projects stub renders", async ({ page }) => {
    await page.goto("/admin/projects");
    await expect(
      page.getByRole("heading", { name: /client projects/i }),
    ).toBeVisible();
    await page.screenshot({
      path: evidence("admin-projects"),
      fullPage: true,
    });
  });

  test("applicable nav items are visible in dashboard sidebar", async ({
    page,
    viewport,
  }) => {
    await page.goto("/dashboard");
    const isMobile = (viewport?.width ?? 1280) < 1024;
    if ((await page.locator(".spaces-shell").count()) > 0) {
      // Spaces on: the same destinations live in the Profile space's sidebar.
      await page.goto("/dashboard/me");
      const sidebar = page.locator("#space-sidebar");
      // The space opens on its Overview; the editor is its own entry (T01).
      await expect(sidebar.locator("a", { hasText: "Overview" })).toHaveAttribute("href", "/dashboard/me");
      await expect(sidebar.locator("a", { hasText: "Public profile" })).toHaveAttribute("href", "/dashboard/me/portfolio");
      await expect(sidebar.locator("a", { hasText: "Visitor messages" })).toHaveAttribute("href", "/dashboard/me/leads");
      await expect(sidebar.locator("a", { hasText: "Opportunities" })).toHaveCount(0);
    } else {
      if (isMobile) {
        const opener = page.getByRole("button", { name: /open navigation/i });
        await expect(opener).toBeEnabled();
        await opener.click();
        await expect(opener).toHaveAttribute("aria-expanded", "true");
      }
      const profileLink = page.getByRole("link", { name: "Profile", exact: true });
      await expect(profileLink).toBeVisible();
      await expect(profileLink).toHaveAttribute("href", "/dashboard/portfolio");
      await expect(page.getByRole("link", { name: "Leads" })).toBeVisible();
      await expect(
        page.getByRole("link", { name: "Opportunities" })
      ).toHaveCount(0);
    }
    await page.screenshot({
      path: evidence("dashboard-nav"),
      fullPage: true,
    });
  });

  test("new nav items are visible in admin sidebar", async ({
    page,
    viewport,
  }) => {
    await page.goto("/admin");
    if ((viewport?.width ?? 1280) < 1024) await openAdminNavigation(page);
    await expect(
      page.getByRole("link", { name: "Profiles", exact: true }),
    ).toBeVisible();
    await expect(
      page.getByRole("link", { name: "Client Projects" }),
    ).toBeVisible();
    await page.screenshot({
      path: evidence("admin-nav"),
      fullPage: true,
    });
  });
});
