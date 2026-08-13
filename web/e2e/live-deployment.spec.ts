import { expect, test } from "@playwright/test";

test("serves the expected live deployment and homepage", async ({ page }) => {
  const healthResponse = await page.request.get("/api/health");
  expect(healthResponse.ok()).toBe(true);
  const health = await healthResponse.json();
  expect(health).toMatchObject({ status: "ok", service: "ttv-website" });

  if (process.env.EXPECTED_DEPLOYMENT_ENVIRONMENT) {
    expect(health.environment).toBe(process.env.EXPECTED_DEPLOYMENT_ENVIRONMENT);
  }
  if (process.env.EXPECTED_DEPLOYMENT_VERSION) {
    expect(health.version).toBe(process.env.EXPECTED_DEPLOYMENT_VERSION);
  }

  await page.goto("/");
  await expect(page).toHaveTitle(/Tembo/i);
  await expect(page.locator("body")).toBeVisible();
});

test("keeps the login route operable", async ({ page }) => {
  await page.goto("/auth/login");
  await expect(page).toHaveURL(/\/auth\/login$/);
  await expect(
    page.getByRole("heading", { name: /pick up where you left off/i })
  ).toBeVisible();
});

test.describe("authenticated delivery agent", () => {
  const token = process.env.PLAYWRIGHT_AGENT_TOKEN;
  test.skip(!token, "No agent bearer token is configured for this environment.");
  test.use({
    extraHTTPHeaders: token ? { Authorization: `Bearer ${token}` } : {},
  });

  test("can inspect authenticated and admin surfaces", async ({ page }) => {
    await page.goto("/dashboard");
    await expect(page).toHaveURL(/\/dashboard\/?$/);

    await page.goto("/admin");
    await expect(page).toHaveURL(/\/admin\/?$/);
    await expect(page.getByRole("heading", { name: "TTV Admin" })).toBeVisible();

    await page.goto("/admin/agent-access");
    await expect(page).toHaveURL(/\/admin\/?$/);
  });

  test("can start and reach the FFmpeg container", async ({ request }) => {
    const response = await request.get(
      "/api/admin/recordings/container-health"
    );

    expect(response.ok()).toBe(true);
    await expect(response.json()).resolves.toEqual({
      ok: true,
      service: "ffmpeg-container",
    });
  });

  test("delegated credentials cannot mint personal access tokens", async ({
    page,
  }) => {
    const response = await page.goto("/admin/personal-access-tokens");
    expect(response?.status()).toBe(403);
    await expect(page.getByText(/delegated credentials cannot manage/i)).toBeVisible();
  });

  test("can inspect a requested recording with a securely supplied token", async ({
    page,
  }, testInfo) => {
    const recordingId = process.env.RECORDING_SMOKE_ID?.trim();
    test.skip(!recordingId, "No recording was selected for authenticated smoke testing.");

    await page.goto(`/admin/recordings/${recordingId}`);
    await expect(
      page.getByRole("heading", { name: "Recording Details" })
    ).toBeVisible();
    await expect(page.getByRole("heading", { name: "Processing" })).toBeVisible();
    await page.screenshot({
      path: `test-results/evidence/${testInfo.project.name}-recording-smoke.png`,
      fullPage: true,
    });
  });
});
