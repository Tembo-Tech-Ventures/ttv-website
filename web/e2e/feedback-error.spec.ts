import { expect, test } from "@playwright/test";

test("a rate-limited submission preserves the draft without claiming success or retrying", async ({ page, baseURL }) => {
  test.skip(baseURL !== "http://127.0.0.1:4322", "Local component harness only; not live API evidence.");
  const message = "You have sent 30 notes in the last day. Thank you! Please try again tomorrow.";
  const draft = "Fictional feedback retained after a daily limit response.";
  let submissions = 0;
  await page.route("**/api/feedback", async (route) => {
    expect(route.request().method()).toBe("POST");
    submissions += 1;
    await route.fulfill({ status: 429, json: { error: message } });
  });
  await page.goto("/feedback.html");
  await page.getByRole("button", { name: "Feedback", exact: true }).click();
  const panel = page.getByTestId("feedback-panel");
  // The fixture must load the actual utilities, not pass against an unstyled dialog.
  await expect(panel).toHaveCSS("display", "flex");
  await expect(panel).toHaveCSS("flex-direction", "column");
  await expect(panel).toHaveCSS("overflow-y", "auto");
  const bounds = await panel.boundingBox();
  expect(bounds!.width).toBeLessThanOrEqual(page.viewportSize()!.width);
  await panel.getByText("Idea", { exact: true }).click();
  await panel.getByLabel("Your feedback").fill(draft);
  await panel.getByRole("button", { name: "Send feedback" }).click();
  await expect(panel.getByRole("alert")).toHaveText(message);
  await expect(panel.getByLabel("Your feedback")).toHaveValue(draft);
  await expect(panel.getByText("Thank you, it's with the team.")).toHaveCount(0);
  await expect(panel.getByRole("button", { name: "Send feedback" })).toBeEnabled();
  expect(submissions).toBe(1);
});
