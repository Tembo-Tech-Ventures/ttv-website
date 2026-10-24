import { expect, test } from "@playwright/test";

test.beforeEach(async ({ page, baseURL }) => {
  test.skip(baseURL !== "http://127.0.0.1:4322", "Local component verification, not live auth or route evidence.");
  await page.goto("/community-audience.html");
  await page.evaluate(() => document.fonts.ready);
});

test("member story stays readable with working navigation and native keyboard disclosures", async ({ page }) => {
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Give your work a story.");
  const join = page.getByRole("link", { name: "Build your community profile" }).first();
  await expect(join).toHaveAttribute("href", "/auth/login?next=%2Fdashboard%2Fcommunity");
  await join.focus();
  expect(await join.evaluate(el => getComputedStyle(el).outlineStyle)).toBe("solid");
  await page.getByRole("link", { name: "See how it works" }).click();
  await expect(page).toHaveURL(/#your-first-contribution$/);
  const question = page.locator("summary").first();
  await question.focus();
  await page.keyboard.press("Enter");
  await expect(page.getByText("Describe a project or contribution and add a source", { exact: false })).toBeVisible();
  await page.keyboard.press("Enter");
  await expect(page.getByText("Describe a project or contribution and add a source", { exact: false })).toBeHidden();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: `test-results/audience-members-${test.info().project.name}.png`, fullPage: true, animations: "disabled" });
});

test("reduced motion keeps all diagram content visible and avoids animations", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.reload();
  const nodes = page.locator(".audience-evidence-path li");
  await expect(nodes).toHaveCount(3);
  for (const node of await nodes.all()) {
    await expect(node).toBeVisible();
    expect(await node.evaluate(el => getComputedStyle(el).animationName)).toBe("none");
    expect(await node.evaluate(el => getComputedStyle(el).opacity)).toBe("1");
  }
  await page.goto("/community-audience.html?signed-in");
  await expect(page.getByRole("link", { name: "Open my community journey" }).first()).toHaveAttribute("href", "/dashboard/community");
});

test("a narrow screen with enlarged text has no horizontal overflow", async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 740 });
  await page.evaluate(() => {
    const elements = [...document.querySelectorAll<HTMLElement>(".community-audience h1, .community-audience h2, .community-audience h3, .community-audience p, .community-audience a, .community-audience summary")];
    const sizes = elements.map(el => Number.parseFloat(getComputedStyle(el).fontSize));
    elements.forEach((el, i) => { el.style.fontSize = `${sizes[i] * 1.25}px`; });
  });
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});
