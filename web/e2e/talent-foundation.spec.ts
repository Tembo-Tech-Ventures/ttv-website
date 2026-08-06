import { expect, test } from "@playwright/test";
import { mkdirSync } from "fs";

const EVIDENCE_DIR = "test-results/evidence";
mkdirSync(EVIDENCE_DIR, { recursive: true });

test.describe("public talent stubs", () => {
  test("/talent returns 200 with heading", async ({ page }) => {
    const response = await page.goto("/talent");
    expect(response?.status()).toBe(200);
    await expect(
      page.getByRole("heading", { name: /meet our/i })
    ).toBeVisible();
    await page.screenshot({
      path: `${EVIDENCE_DIR}/talent-stub.png`,
      fullPage: true,
    });
  });

  test("/hire returns 200 with heading", async ({ page }) => {
    const response = await page.goto("/hire");
    expect(response?.status()).toBe(200);
    await expect(
      page.getByRole("heading", { name: /work with/i })
    ).toBeVisible();
    await page.screenshot({
      path: `${EVIDENCE_DIR}/hire-stub.png`,
      fullPage: true,
    });
  });
});

test.describe("authenticated talent foundation", () => {
  const token = process.env.PLAYWRIGHT_AGENT_TOKEN;
  test.skip(!token, "No agent bearer token is configured for this environment.");
  test.use({
    extraHTTPHeaders: token ? { Authorization: `Bearer ${token}` } : {},
  });

  test("dashboard/portfolio stub renders", async ({ page }) => {
    await page.goto("/dashboard/portfolio");
    await expect(
      page.getByRole("heading", { name: /portfolio/i })
    ).toBeVisible();
    await page.screenshot({
      path: `${EVIDENCE_DIR}/dashboard-portfolio.png`,
      fullPage: true,
    });
  });

  test("dashboard/leads stub renders", async ({ page }) => {
    await page.goto("/dashboard/leads");
    await expect(
      page.getByRole("heading", { name: /leads/i })
    ).toBeVisible();
    await page.screenshot({
      path: `${EVIDENCE_DIR}/dashboard-leads.png`,
      fullPage: true,
    });
  });

  test("dashboard/opportunities stub renders", async ({ page }) => {
    await page.goto("/dashboard/opportunities");
    await expect(
      page.getByRole("heading", { name: /opportunities/i })
    ).toBeVisible();
    await page.screenshot({
      path: `${EVIDENCE_DIR}/dashboard-opportunities.png`,
      fullPage: true,
    });
  });

  test("admin/profiles stub renders", async ({ page }) => {
    await page.goto("/admin/profiles");
    await expect(
      page.getByRole("heading", { name: /profiles/i })
    ).toBeVisible();
    await page.screenshot({
      path: `${EVIDENCE_DIR}/admin-profiles.png`,
      fullPage: true,
    });
  });

  test("admin/projects stub renders", async ({ page }) => {
    await page.goto("/admin/projects");
    await expect(
      page.getByRole("heading", { name: /client projects/i })
    ).toBeVisible();
    await page.screenshot({
      path: `${EVIDENCE_DIR}/admin-projects.png`,
      fullPage: true,
    });
  });

  test("new nav items are visible in dashboard sidebar", async ({ page }) => {
    await page.goto("/dashboard");
    await expect(page.getByRole("link", { name: "Portfolio" })).toBeVisible();
    await expect(page.getByRole("link", { name: "Leads" })).toBeVisible();
    await expect(
      page.getByRole("link", { name: "Opportunities" })
    ).toBeVisible();
    await page.screenshot({
      path: `${EVIDENCE_DIR}/dashboard-nav.png`,
      fullPage: true,
    });
  });

  test("new nav items are visible in admin sidebar", async ({ page }) => {
    await page.goto("/admin");
    await expect(page.getByRole("link", { name: "Profiles" })).toBeVisible();
    await expect(
      page.getByRole("link", { name: "Client Projects" })
    ).toBeVisible();
    await page.screenshot({
      path: `${EVIDENCE_DIR}/admin-nav.png`,
      fullPage: true,
    });
  });
});
