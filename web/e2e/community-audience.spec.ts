import { expect, test } from "@playwright/test";

test.beforeEach(async ({ page, baseURL }) => {
  test.skip(baseURL !== "http://127.0.0.1:4322", "Local component verification, not live auth or route evidence.");
  await page.goto("/community-audience.html");
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
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

for (const [audience, headline, cta, destination] of [
  ["mentors", "Make the contribution clearer.", "Continue to mentor review", "/dashboard/mentorship"],
  ["institutions", "Look beyond the profile. Understand the work.", "Continue to institutional access", "/dashboard/discover"],
]) {
  test(`${audience} explains approval, supports keyboard disclosures and retains its CTA destination`, async ({ page }) => {
    await page.goto(`/community-audience.html?audience=${audience}`);
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
    await page.evaluate(() => document.fonts.ready);
    await expect(page.getByRole("heading", { level: 1 })).toHaveText(headline);
    const link = page.getByRole("link", { name: cta }).first();
    await expect(link).toHaveAttribute("href", `/auth/login?next=${encodeURIComponent(destination)}`);
    await expect(page.locator(".audience-cta-note")).toContainText("administrator approval after sign-in");
    await link.focus();
    expect(await link.evaluate(el => getComputedStyle(el).outlineStyle)).toBe("solid");
    await page.getByRole("link", { name: "See how it works" }).click();
    await expect(page).toHaveURL(/#participation$/);
    const question = page.locator("details").first();
    await question.locator("summary").focus();
    await page.keyboard.press("Enter");
    await expect(question.locator("p")).toBeVisible();
    await page.keyboard.press("Enter");
    await expect(question.locator("p")).toBeHidden();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.screenshot({ path: `test-results/audience-${audience}-${test.info().project.name}.png`, fullPage: true, animations: "disabled" });
    await page.goto(`/community-audience.html?audience=${audience}&signed-in`);
    await expect(page.getByRole("link", { name: cta }).first()).toHaveAttribute("href", destination);
    await expect(page.locator(".audience-cta-note")).toContainText("administrator approval");
  });
  test(`${audience} stays readable at 320px with enlarged text and reduced motion`, async ({ page }) => {
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.setViewportSize({ width: 320, height: 740 });
    await page.goto(`/community-audience.html?audience=${audience}`);
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
    await page.evaluate(() => document.fonts.ready);
    await page.evaluate(() => {
      const elements = [...document.querySelectorAll<HTMLElement>(".community-audience h1, .community-audience h2, .community-audience h3, .community-audience p, .community-audience a, .community-audience summary")];
      const sizes = elements.map(el => Number.parseFloat(getComputedStyle(el).fontSize));
      elements.forEach((el, i) => { el.style.fontSize = `${sizes[i] * 1.25}px`; });
    });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    const nodes = page.locator(".audience-evidence-path li");
    await expect(nodes).toHaveCount(3);
    for (const node of await nodes.all()) {
      await expect(node).toBeVisible();
      expect(await node.evaluate(el => getComputedStyle(el).animationName)).toBe("none");
      expect(await node.evaluate(el => getComputedStyle(el).opacity)).toBe("1");
    }
  });
}

for (const audience of ["members", "mentors", "institutions"]) {
  test(`${audience} context text stays within its column at desktop and tablet widths`, async ({ page }) => {
    await page.goto(`/community-audience.html?audience=${audience}`);
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
    await page.evaluate(() => document.fonts.ready);
    for (const width of [701, 900, 1280, 1536]) {
      await page.setViewportSize({ width, height: 1000 });
      const geometry = await page.locator(".audience-context").evaluate(section => {
        const [left, right] = [...section.children].map(column => column.getBoundingClientRect());
        const escapedText: string[] = [];
        for (const column of section.children) {
          const bounds = column.getBoundingClientRect();
          for (const text of column.querySelectorAll("h2,h3,p")) {
            const range = document.createRange(); range.selectNodeContents(text);
            if ([...range.getClientRects()].some(rect => rect.left < bounds.left - 1 || rect.right > bounds.right + 1)) escapedText.push(text.textContent ?? "");
          }
        }
        return { gap: right.left - left.right, escapedText };
      });
      expect(geometry.escapedText, `text escaped a context column at ${width}px`).toEqual([]);
      expect(geometry.gap, `columns overlap at ${width}px`).toBeGreaterThanOrEqual(31);
    }
  });
}

// Workspace headings separate sentences with <br>, which textContent omits.
test("workspace heading assertions preserve rendered sentence breaks", async ({ page }) => {
  for (const [first, second] of [
    ["Your work.", "Your story."],
    ["Recognise the work.", "Name what you saw."],
    ["Find the person.", "See the work."],
  ]) {
    await page.setContent(`<h1>${first}<br><em>${second}</em></h1>`);
    const heading = page.getByRole("heading", { level: 1 });
    expect(await heading.textContent()).toBe(first + second);
    await expect(heading).toHaveText(`${first} ${second}`, { useInnerText: true });
    await page.setContent("<h1>We could not open this workspace.</h1>");
    await expect(heading).not.toHaveText(`${first} ${second}`, { useInnerText: true });
  }
});

for (const audience of ["community", "members", "mentors", "institutions"]) {
  test(`${audience} redesigned sheets keep every line readable and motion optional`, async ({ page }) => {
    const { installTextTracker, walkAndSample, textReport } = await import("./text-integrity");
    await page.goto(`/community-audience.html?audience=${audience}`);
    await page.evaluate(() => document.fonts.ready);
    await page.waitForTimeout(1000);
    await installTextTracker(page, "main");
    await walkAndSample(page);
    const report = await textReport(page);
    expect(report.issues.filter(issue => !issue.decorative)).toEqual([]);
    expect(report.maxHorizontalOverflow).toBeLessThanOrEqual(1);
    await page.emulateMedia({ reducedMotion: "reduce" });
    const animated = await page.locator("main *").evaluateAll(elements => elements.filter(el => getComputedStyle(el).animationName !== "none").length);
    expect(animated).toBe(0);
  });
}

test("community map leads to all personas, lifts cards on focus, and preserves signed-in entry", async ({ page }) => {
  await page.goto("/community-audience.html?audience=community");
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Good work.Better together.");
  for (const persona of ["members", "mentors", "institutions"]) {
    const link = page.getByRole("link", { name: `For ${persona}`, exact: true });
    await expect(link).toHaveAttribute("href", `/community/${persona}`);
    await link.focus();
    await expect(link).toBeFocused();
    expect(await link.evaluate(el => getComputedStyle(el).outlineStyle)).toBe("solid");
  }
  await page.goto("/community-audience.html?audience=community&signed-in");
  await expect(page.getByRole("link", { name: "Open my community journey" })).toHaveAttribute("href", "/dashboard/community");
  await expect(page.getByRole("link", { name: "Continue to institutional access" })).toHaveAttribute("href", "/dashboard/discover");
  await page.setViewportSize({ width: 320, height: 740 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});
