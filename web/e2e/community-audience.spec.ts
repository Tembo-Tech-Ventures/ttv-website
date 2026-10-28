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

for (const audience of ["community", "members", "mentors", "institutions"]) {
  test(`${audience} keeps layered surfaces without trapping anchors or keyboard focus`, async ({ page }) => {
    await page.goto(`/community-audience.html?audience=${audience}`);
    const root = page.locator("[data-community-root]");
    await expect(root).not.toHaveClass(/hp-stacked/);
    await expect(root.locator("[data-hp-sheet]")).toHaveCount(5);
    await page.emulateMedia({ reducedMotion: "reduce" });
    await expect(root).not.toHaveClass(/hp-stacked/);
    const geometry = await root.locator("[data-hp-sheet]").evaluateAll(sheets => sheets.map(el => ({
      width: el.getBoundingClientRect().width,
      radius: Number.parseFloat(getComputedStyle(el).borderTopLeftRadius),
      transform: getComputedStyle(el).transform,
      opacity: getComputedStyle(el).opacity,
    })));
    for (const sheet of geometry) {
      expect(sheet.width).toBeCloseTo(page.viewportSize()!.width, 0);
      expect(sheet.radius).toBeGreaterThanOrEqual(24);
      expect(sheet.transform).toBe("none");
      expect(sheet.opacity).toBe("1");
    }
    await page.emulateMedia({ reducedMotion: "no-preference" });
    await expect(root).not.toHaveClass(/hp-stacked/);
    await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
    const firstAction = root.locator(".audience-button").first();
    await firstAction.focus();
    await expect.poll(() => firstAction.evaluate(el => {
      const box = el.getBoundingClientRect();
      const hit = document.elementFromPoint(box.left + box.width / 2, box.top + box.height / 2);
      return box.top >= 0 && box.bottom <= innerHeight && !!hit && el.contains(hit);
    })).toBe(true);
    const link = root.locator('a[href^="#"]').first();
    await link.click();
    const hash = await link.getAttribute("href");
    const heading = page.locator(`${hash} h2`).first();
    await expect.poll(() => heading.evaluate(el => {
      const box = el.getBoundingClientRect();
      return box.top >= 0 && box.bottom <= innerHeight;
    })).toBe(true);
  });
}

for (const audience of ["community", "members", "mentors", "institutions"]) {
  test(`${audience} scrolls in order with stable alignment and opaque reading surfaces in both directions`, async ({ page }) => {
    await page.goto(`/community-audience.html?audience=${audience}`);
    await page.evaluate(() => document.fonts.ready);
    const surfaces = page.locator("[data-hp-sheet]");
    const measure = () => surfaces.evaluateAll(sheets => sheets.map(el => {
      const box = el.getBoundingClientRect();
      const style = getComputedStyle(el);
      const body = el.querySelector(".hp-sheet__body")!.getBoundingClientRect();
      return { top: box.top, left: box.left, width: box.width, opacity: style.opacity, transform: style.transform, contentBottom: body.bottom };
    }));
    const total = await page.evaluate(() => document.documentElement.scrollHeight - innerHeight);
    const positions = Array.from({ length: Math.ceil(total / 160) + 1 }, (_, i) => Math.min(i * 160, total));
    let previous = await measure();
    let previousY = 0;
    for (const y of [...positions, ...positions.toReversed()]) {
      await page.evaluate(position => scrollTo({ top: position, behavior: "instant" }), y);
      await page.waitForTimeout(20);
      const actualY = await page.evaluate(() => scrollY);
      const current = await measure();
      for (let i = 0; i < current.length; i++) {
        const sheet = current[i];
        expect(sheet.top - previous[i].top).toBeCloseTo(previousY - actualY, 0);
        expect(sheet.left).toBeCloseTo(0, 0);
        expect(sheet.width).toBeCloseTo(page.viewportSize()!.width, 0);
        expect(sheet.opacity).toBe("1");
        expect(sheet.transform).toBe("none");
        if (current[i + 1]) expect(sheet.contentBottom + 20).toBeLessThan(current[i + 1].top);
      }
      previous = current;
      previousY = actualY;
    }
  });
}

for (const audience of ["members", "mentors", "institutions"]) {
  test(`${audience} expands answers in place and pushes the closing section down`, async ({ page }) => {
    await page.goto(`/community-audience.html?audience=${audience}`);
    const details = page.locator("details").first();
    const summary = details.locator("summary");
    await summary.evaluate(el => scrollTo(0, el.getBoundingClientRect().top + scrollY - 220));
    const before = (await summary.boundingBox())!;
    const close = page.locator(".hp-sheet--last");
    const closingBefore = (await close.boundingBox())!;
    await summary.click();
    await expect(details).toHaveAttribute("open", "");
    const after = (await summary.boundingBox())!;
    expect(after.y).toBeCloseTo(before.y, 0);
    expect(after.x).toBeCloseTo(before.x, 0);
    const answerHeight = (await details.locator("p").boundingBox())!.height;
    expect((await close.boundingBox())!.y - closingBefore.y).toBeGreaterThanOrEqual(answerHeight);
    expect(await details.evaluate(el => getComputedStyle(el.closest("[data-hp-sheet]")!).opacity)).toBe("1");
    await summary.click();
    expect((await summary.boundingBox())!.y).toBeCloseTo(before.y, 0);
  });
}

test("interactive cards stay upright on hover and still touch no neighbours", async ({ page, isMobile }) => {
  await page.goto("/community-audience.html?audience=community");
  const cards = page.locator(".community-path");
  for (const card of await cards.all()) {
    await card.scrollIntoViewIfNeeded();
    if (!isMobile) await card.hover();
    else await card.focus();
    await page.waitForTimeout(250);
    const matrix = await card.evaluate(el => {
      const m = new DOMMatrixReadOnly(getComputedStyle(el).transform);
      return { a: m.a, b: m.b, c: m.c, d: m.d };
    });
    expect(matrix).toEqual({ a: 1, b: 0, c: 0, d: 1 });
    const boxes = await cards.evaluateAll(els => els.map(el => {
      const b = el.getBoundingClientRect(); return { left: b.left, right: b.right, top: b.top, bottom: b.bottom };
    }));
    for (let i = 0; i < boxes.length - 1; i++) {
      const a = boxes[i], b = boxes[i + 1];
      expect(a.right < b.left || a.bottom < b.top).toBe(true);
    }
  }
});

test("illustrations arrive when reached and do not replay when scrolling back", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 600 });
  await page.goto("/community-audience.html?audience=community");
  await page.evaluate(() => document.fonts.ready);
  const firstCard = page.locator(".community-deck-card").first();
  await expect(firstCard).not.toHaveClass(/is-arriving/);
  await firstCard.scrollIntoViewIfNeeded();
  await expect(firstCard).toHaveClass(/is-arriving/);
  await page.waitForTimeout(800);
  expect(await firstCard.evaluate(el => getComputedStyle(el).opacity)).toBe("1");
  await page.evaluate(() => scrollTo(0, 0));
  await firstCard.scrollIntoViewIfNeeded();
  expect(await firstCard.evaluate(el => el.getAnimations().filter(a => a.playState === "running").length)).toBe(0);
});

test("breadcrumb and hero content share a gutter through tablet breakpoints", async ({ page }) => {
  for (const width of [390, 650, 768, 1024, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    const breadcrumb = (await page.locator(".audience-breadcrumb a").boundingBox())!;
    const heading = (await page.locator("h1").boundingBox())!;
    expect(breadcrumb.x).toBeCloseTo(heading.x, 0);
  }
});
