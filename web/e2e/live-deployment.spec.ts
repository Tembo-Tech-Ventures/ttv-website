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

  test("can complete a shared project-board workflow", async (
    { page },
    testInfo
  ) => {
    const boardName = `Agent board ${testInfo.project.name} ${Date.now()}`;

    await page.goto("/dashboard/boards");
    await expect(
      page.getByRole("heading", { name: "Project Boards" })
    ).toBeVisible();

    await page.getByLabel("Board name").fill(boardName);
    await page
      .getByLabel("Description")
      .fill("Temporary browser verification board.");
    await page.getByRole("button", { name: "Create board" }).click();

    await expect(page).toHaveURL(/\/dashboard\/boards\/[a-z0-9]+/);
    await expect(page.getByRole("heading", { name: boardName })).toBeVisible();

    await page.getByLabel("Task title").fill("Verify the board workflow");
    await page.getByRole("button", { name: "Add task" }).click();
    await expect(
      page.getByRole("heading", { name: "Verify the board workflow" })
    ).toBeVisible();

    await page.getByText("Edit task", { exact: true }).click();
    await page.getByLabel("Status").selectOption("DONE");
    await page.getByRole("button", { name: "Save task" }).click();
    await expect(
      page.getByRole("progressbar", { name: "Board completion" })
    ).toHaveAttribute("aria-valuenow", "100");

    await page.getByText("Board settings", { exact: true }).click();
    page.once("dialog", (dialog) => dialog.accept());
    await page.getByRole("button", { name: "Delete board" }).click();

    await expect(page).toHaveURL(/\/dashboard\/boards\?notice=/);
    await expect(page.getByRole("status")).toContainText("Board deleted.");
  });
});
