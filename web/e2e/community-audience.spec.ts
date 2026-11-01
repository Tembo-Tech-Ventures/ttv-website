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

for (const [audience, headline, cta, destination, requestCta, question] of [
  ["mentors", "Make the contribution clearer.", "Continue to mentor review", "/dashboard/welcome?intent=mentor", "Ask to mentor", "Can I start reviewing as soon as I sign in?"],
  ["institutions", "Look beyond the profile. Understand the work.", "Continue to institutional access", "/dashboard/welcome?intent=institution", "Ask for institutional access", "Who can use institutional discovery?"],
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

  test(`${audience} describes the request and approval once onboarding is on`, async ({ page }) => {
    await page.goto(`/community-audience.html?audience=${audience}&onboarding`);
    await expect(page.getByRole("heading", { level: 1 })).toHaveText(headline);
    await page.evaluate(() => document.fonts.ready);
    const links = page.getByRole("link", { name: requestCta });
    await expect(links).toHaveCount(2);
    for (const link of await links.all()) await expect(link).toHaveAttribute("href", `/auth/login?next=${encodeURIComponent(destination)}`);
    const answer = page.locator("details").filter({ hasText: question });
    await answer.locator("summary").click();
    await expect(answer.locator("p")).toContainText("An administrator reads each request and decides; approval is not guaranteed.");
    await expect(answer.locator("p")).toContainText("pending");
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await answer.scrollIntoViewIfNeeded();
    await page.screenshot({ path: `test-results/audience-${audience}-request-faq-${test.info().project.name}.png`, animations: "disabled" });
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
    await expect(root).toHaveClass(/hp-stacked/);
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
    await expect(root).toHaveClass(/hp-stacked/);
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
    await expect(page.locator("[data-community-root]")).toHaveClass(/hp-stacked/);
    let sawSlide = false;
    let previous = await measure();
    let previousY = 0;
    for (const y of [...positions, ...positions.toReversed()]) {
      await page.evaluate(position => scrollTo({ top: position, behavior: "instant" }), y);
      await page.waitForTimeout(20);
      const actualY = await page.evaluate(() => scrollY);
      const current = await measure();
      for (let i = 0; i < current.length; i++) {
        const sheet = current[i];
        const movement = sheet.top - previous[i].top;
        const scroll = previousY - actualY;
        expect(movement).toBeGreaterThanOrEqual(Math.min(0, scroll) - 1);
        expect(movement).toBeLessThanOrEqual(Math.max(0, scroll) + 1);
        if (Math.abs(movement) < 1 && scroll < -20 && current[i + 1] && current[i + 1].top < previous[i + 1].top - 20) sawSlide = true;
        expect(sheet.left).toBeCloseTo(0, 0);
        expect(sheet.width).toBeCloseTo(page.viewportSize()!.width, 0);
        expect(sheet.opacity).toBe("1");
        expect(sheet.transform).toBe("none");
      }
      previous = current;
      previousY = actualY;
    }
    expect(sawSlide, "the next sheet visibly slides over a stationary previous sheet").toBe(true);
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

for (const audience of ["members", "mentors", "institutions"]) {
  test(`${audience} keeps complete matching cards behind the foreground panel and ends its connector at the final node`, async ({ page }) => {
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.goto(`/community-audience.html?audience=${audience}`);
    await page.evaluate(() => document.fonts.ready);
    for (const width of [320, 390, 768, 1440]) {
      await page.setViewportSize({ width, height: 900 });
      const figure = page.locator(".audience-trail");
      const cards = await page.locator("[data-card-stack]").evaluate(el => [...el.children].map(child => {
        const box = child.getBoundingClientRect();
        return { width: box.width, height: box.height, left: box.left, top: box.top, radius: getComputedStyle(child).borderTopLeftRadius };
      }));
      for (const [index, card] of cards.entries()) {
        expect(card.width).toBeCloseTo(cards[2].width, 0);
        expect(card.height).toBeCloseTo(cards[2].height, 0);
        expect(card.left).toBeCloseTo(cards[2].left, 0);
        expect(card.top).toBeCloseTo(cards[2].top - (2 - index) * 12, 0);
        expect(card.radius).toBe("22px");
      }
      const contents = await figure.evaluate(el => {
        const box = el.getBoundingClientRect();
        return [...el.children].map(child => {
          const b = child.getBoundingClientRect();
          return Math.min(b.left - box.left, box.right - b.right, b.top - box.top, box.bottom - b.bottom);
        });
      });
      for (const inset of contents) expect(inset).toBeGreaterThanOrEqual(15);
      const segments = await page.locator(".audience-evidence-path li").evaluateAll(items => items.map((item, i) => {
        const s = getComputedStyle(item, "::before");
        const node = item.querySelector(".audience-node")!.getBoundingClientRect();
        const next = items[i + 1]?.querySelector(".audience-node")?.getBoundingClientRect();
        const start = item.getBoundingClientRect().top + parseFloat(s.top);
        return { content: s.content, start, expectedStart: node.top + node.height / 2, end: start + parseFloat(s.height), expectedEnd: next ? next.top + next.height / 2 : null };
      }));
      for (const segment of segments.slice(0, -1)) {
        expect(segment.start).toBeCloseTo(segment.expectedStart, 0);
        expect(segment.end).toBeCloseTo(segment.expectedEnd!, 0);
      }
      expect(segments.at(-1)!.content).toBe("none");
    }
  });
}

test("community timeline connects each dot to the next without a dangling final rule", async ({ page }) => {
  await page.goto("/community-audience.html?audience=community");
  const items = page.locator(".community-common li");
  for (const [i, item] of (await items.all()).entries()) {
    const line = await item.evaluate(el => {
      const style = getComputedStyle(el, "::after");
      return { content: style.content, height: parseFloat(style.height), itemHeight: el.getBoundingClientRect().height };
    });
    if (i === 2) expect(line.content).toBe("none");
    else expect(line.height).toBeCloseTo(line.itemHeight, 0);
  }
});

test("diagram marker shapes are centered independently of font baselines", async ({ page }) => {
  for (const audience of ["community", "members", "mentors", "institutions"]) {
    await page.goto(`/community-audience.html?audience=${audience}`);
    const markers = await page.locator(".audience-node, .path-symbol, .deck-glyph").evaluateAll(nodes => nodes.map(node => {
      const s = getComputedStyle(node);
      const shape = getComputedStyle(node, node.matches(".audience-node") ? "::after" : "::before");
      return { position: shape.position, translate: shape.translate, left: parseFloat(shape.left), top: parseFloat(shape.top), parentWidth: node.clientWidth, parentHeight: node.clientHeight, fontSize: s.fontSize, display: s.display, align: s.alignItems, justify: s.justifyItems, width: parseFloat(shape.width), height: parseFloat(shape.height), content: shape.content };
    }));
    for (const marker of markers) {
      expect(marker.position).toBe("absolute");
      expect(marker.translate).toBe("-50% -50%");
      expect(marker.left).toBeCloseTo(marker.parentWidth / 2, 0);
      expect(marker.top).toBeCloseTo(marker.parentHeight / 2, 0);
      expect(marker.fontSize).toBe("0px");
      expect(marker.display).toBe("grid");
      expect(marker.align).toBe("center");
      expect(marker.justify).toBe("center");
      expect(marker.width).toBe(marker.height);
      expect(marker.width).toBeGreaterThan(0);
      expect(marker.content).not.toBe("none");
    }
  }
});

for (const audience of ["members", "mentors", "institutions"]) {
  test(`${audience} assembles one file with distinct depth poses and optional motion`, async ({ page }) => {
    await page.goto(`/community-audience.html?audience=${audience}`);
    const stack = page.locator("[data-card-stack]");
    await stack.scrollIntoViewIfNeeded();
    await expect(stack).toHaveClass(/is-arriving/);
    const timing = await stack.evaluate(el => [...el.children].map(child => {
      const animation = child.getAnimations().find(a => a instanceof CSSAnimation && a.animationName.startsWith("audience-file-"))!;
      animation.pause();
      animation.currentTime = 170;
      return { delay: Number(animation.effect!.getTiming().delay), opacity: Number(getComputedStyle(child).opacity), pose: getComputedStyle(child).transform, name: (animation as CSSAnimation).animationName };
    }));
    expect(timing[0].delay).toBeLessThan(timing[1].delay);
    expect(timing[1].delay).toBeLessThan(timing[2].delay);
    expect(new Set(timing.map(t => t.name)).size).toBe(3);
    expect(new Set(timing.map(t => t.pose)).size).toBe(3);
    expect(timing[0].opacity).toBeGreaterThan(timing[1].opacity);
    expect(timing[1].opacity).toBeGreaterThan(timing[2].opacity);
    expect(timing[2].opacity).toBe(0);
    await stack.evaluate(el => [...el.children].forEach(child => child.getAnimations().forEach(a => a.finish())));
    for (const layer of await stack.locator(":scope > *").all()) {
      expect(await layer.evaluate(el => getComputedStyle(el).opacity)).toBe("1");
      expect(["none", "blur(0px)"]).toContain(await layer.evaluate(el => getComputedStyle(el).filter));
    }
    await page.emulateMedia({ reducedMotion: "reduce" });
    await expect(stack).not.toHaveClass(/is-pending/);
    expect(await stack.evaluate(el => el.getAnimations({ subtree: true }).length)).toBe(0);
    expect(await stack.locator("figure").evaluate(el => getComputedStyle(el).opacity)).toBe("1");
    // Unenhanced server markup must stay visible if motion initialization fails.
    await stack.evaluate(el => el.classList.remove("is-arriving", "is-pending"));
    expect(await stack.locator("figure").evaluate(el => getComputedStyle(el).opacity)).toBe("1");
  });
}


test("a fast scroll settles the file, and motion preference changes never replay it", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/community-audience.html?audience=members");
  const stack = page.locator("[data-card-stack]");
  await stack.scrollIntoViewIfNeeded();
  await expect(stack).toHaveClass(/is-arriving/);
  await page.evaluate(() => scrollTo(0, document.documentElement.scrollHeight));
  await expect(stack).toHaveClass(/is-settled/);
  await stack.scrollIntoViewIfNeeded();
  expect(await stack.evaluate(el => el.getAnimations({ subtree: true }).filter(a => a.playState === "running").length)).toBe(0);
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.emulateMedia({ reducedMotion: "no-preference" });
  await expect(stack).not.toHaveClass(/is-pending|is-arriving/);
  await expect(stack).toHaveClass(/is-settled/);
  expect(await stack.evaluate(el => el.getAnimations({ subtree: true }).length)).toBe(0);
});
