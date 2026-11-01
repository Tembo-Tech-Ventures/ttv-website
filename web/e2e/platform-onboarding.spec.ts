import { mkdirSync } from "node:fs";
import { expect, test, type Browser, type Page } from "@playwright/test";
import { runAxe } from "./platform-axe";
import { installTextTracker, textReport, walkAndSample } from "./text-integrity";

/**
 * The browser contract for the onboarding welcome and request steps (U-O.1).
 *
 * Against `astro dev`, the DEV-only harness `/dev/platform-onboarding` runs
 * the real flow and screen against in-memory fixture state for the fixture
 * personas. Unit tests cover the flow and the islands; this covers what only
 * a browser can: the form posts end to end with and without JavaScript, focus
 * on each step's h1 and on problems, keyboard order, axe, containment and
 * text at every width, reduced motion, and the card's selection gesture.
 *
 * Against a deployed build it checks that the harness is absent.
 */
const HARNESS = "/dev/platform-onboarding";
const LANDING = "/dev/platform-shell";
const EVIDENCE_DIR = "test-results/evidence/platform-onboarding";
const SWEEP = [320, 360, 390, 414, 600, 768, 960, 1024, 1280, 1440];
mkdirSync(EVIDENCE_DIR, { recursive: true });

type Persona = "wairimu" | "mercyAkinyi" | "josephOchieng" | "peter";

/** The harness for a persona, in this test's own copy of its state: projects run in parallel. */
function harness(persona: Persona, extra: Record<string, string> = {}) {
  const info = test.info();
  const run = `${info.project.name}-${info.testId}`;
  return `${HARNESS}?${new URLSearchParams({ persona, run, ...extra })}`;
}

/** Chromium in the dev container cannot reach Google Fonts itself; Node can. */
async function routeFonts(page: Page) {
  await page.route(/fonts\.(googleapis|gstatic)\.com/, async (route) => {
    try {
      const response = await fetch(route.request().url());
      await route.fulfill({ status: response.status, headers: Object.fromEntries(response.headers), body: Buffer.from(await response.arrayBuffer()) });
    } catch {
      await route.abort();
    }
  });
}

/** Each test owns its persona's state: start from the fixture. */
async function reset(page: Page, persona: Persona) {
  expect((await page.request.get(harness(persona, { reset: "" }), { maxRedirects: 0 })).status()).toBe(303);
}

async function state(page: Page, persona: Persona) {
  return (await page.request.get(harness(persona, { state: "" }))).json() as Promise<{
    stage: string; intents: string[]; roles: string[]; requests: { role: string; status: string; note: string }[];
  }>;
}

async function settled(page: Page, scripted = true) {
  await page.waitForLoadState("load");
  if (scripted) await expect(page.locator("astro-island[ssr]")).toHaveCount(0);
  await page.evaluate(() => document.fonts.ready);
}

async function open(page: Page, path: string, scripted = true) {
  await routeFonts(page);
  await page.goto(path);
  await settled(page, scripted);
}

const main = (page: Page) => page.locator("main");
const heading = (page: Page) => main(page).getByRole("heading", { level: 1 });
const card = (page: Page, intent: "member" | "mentor" | "institution") => page.locator(`.welcome-choice[data-intent=${intent}]`);
const checkbox = (page: Page, name: string) => main(page).getByRole("checkbox", { name, exact: true });
const continueButton = (page: Page) => main(page).getByRole("button", { name: "Continue" });
const exploreButton = (page: Page) => main(page).getByRole("button", { name: "I’m just looking around" });
const focused = (page: Page) => page.evaluate(() => {
  const el = document.activeElement;
  return el ? `${el.tagName.toLowerCase()}:${el.getAttribute("aria-label") ?? el.id ?? ""}:${(el.textContent ?? "").trim().slice(0, 40)}` : "none";
});

function evidence(name: string) {
  return `${EVIDENCE_DIR}/${test.info().project.name}-${name}.png`;
}

/** Nothing scrolls sideways, every box in main stays inside the viewport, and no two cards overlap. */
async function expectContained(page: Page) {
  const report = await page.evaluate(() => {
    const width = document.documentElement.clientWidth;
    const outside = Array.from(document.querySelectorAll<HTMLElement>("main *"))
      .filter((el) => {
        const style = getComputedStyle(el);
        if (style.position === "absolute" && el.getBoundingClientRect().width <= 1) return false; // visually hidden
        const box = el.getBoundingClientRect();
        return box.width > 0 && (box.left < -0.5 || box.right > width + 0.5);
      })
      .map((el) => el.className || el.tagName);
    const cards = Array.from(document.querySelectorAll(".welcome-choice")).map((el) => el.getBoundingClientRect());
    const overlaps = cards.flatMap((a, i) => cards.slice(i + 1).filter((b) =>
      a.left < b.right - 0.5 && b.left < a.right - 0.5 && a.top < b.bottom - 0.5 && b.top < a.bottom - 0.5).map(() => i));
    return { scroll: document.documentElement.scrollWidth - width, outside, overlaps };
  });
  expect(report).toEqual({ scroll: 0, outside: [], overlaps: [] });
}

test.describe("deployed builds", () => {
  test("have no onboarding harness", async ({ page }) => {
    test.skip(!process.env.PLAYWRIGHT_BASE_URL, "Only deployed builds prove the harness is absent.");
    expect((await page.request.get(harness("wairimu"))).status()).toBe(404);
  });
});

test.describe("the welcome and request steps (DEV harness)", () => {
  test.skip(Boolean(process.env.PLAYWRIGHT_BASE_URL), "The harness is dev-only and unavailable on deployed environments.");
  test.use({ reducedMotion: "reduce" });

  test.beforeEach(async ({ page }, testInfo) => {
    await page.setViewportSize(testInfo.project.name === "mobile-chromium" ? { width: 390, height: 844 } : { width: 1440, height: 900 });
  });

  test("opens on the h1, then reads the cards, Continue and just looking around in order", async ({ page }) => {
    await reset(page, "wairimu");
    await open(page, harness("wairimu"));
    await expect(heading(page)).toHaveText("How will you take part?");
    await expect(heading(page)).toBeFocused();
    await expect(page).toHaveTitle(/^How will you take part\?/);
    const order: string[] = [];
    for (let step = 0; step < 5; step += 1) {
      await page.keyboard.press("Tab");
      order.push(await focused(page));
    }
    expect(order.map((entry) => entry.split(":").slice(0, 1)[0])).toEqual(["input", "input", "input", "button", "button"]);
    expect(order[0]).toContain("welcome-choice-member");
    expect(order[3]).toContain("Continue");
    expect(order[4]).toContain("just looking around");
    // Before the h1, only the brand and the account menu.
    await heading(page).focus();
    await page.keyboard.press("Shift+Tab");
    expect(await focused(page)).toContain("Account menu");
  });

  test("chooses with the keyboard, and shows a chosen card in a still frame", async ({ page }) => {
    await reset(page, "wairimu");
    await open(page, harness("wairimu"));
    await page.keyboard.press("Tab");
    await page.keyboard.press("Space");
    await page.keyboard.press("Tab");
    await page.keyboard.press("Space");
    await expect(checkbox(page, "Build and learn")).toBeChecked();
    await expect(checkbox(page, "Mentor")).toBeChecked();
    await expect(checkbox(page, "Find people for your organisation")).not.toBeChecked();
    const looks = await page.evaluate(() => Array.from(document.querySelectorAll<HTMLElement>(".welcome-choice")).map((el) => {
      const style = getComputedStyle(el);
      return { border: style.borderTopColor, outline: style.outlineStyle };
    }));
    expect(looks[0]!.border).toBe("rgb(242, 141, 104)");
    expect(looks[1]).toEqual({ border: "rgb(242, 141, 104)", outline: "solid" });
    expect(looks[2]!.border).not.toBe("rgb(242, 141, 104)");
    if (test.info().project.name === "mobile-chromium") await expect(page.locator(".welcome-actions__count")).toHaveText("2 selected");
    await page.screenshot({ path: evidence("01-welcome") });
    await page.screenshot({ path: evidence("01-welcome-full"), fullPage: true });
    await expectContained(page);
  });

  test("asks for a choice instead of continuing with none", async ({ page }) => {
    await reset(page, "wairimu");
    await open(page, harness("wairimu"));
    await continueButton(page).click();
    await expect(main(page).getByRole("alert")).toHaveText("Choose at least one, or pick ‘I’m just looking around’.");
    expect(page.url()).toContain(HARNESS);
    expect((await state(page, "wairimu")).stage).toBe("NEW");
    await card(page, "member").click();
    await expect(main(page).getByRole("alert")).toHaveText("");
  });

  test("preselects the hinted card without sending anything", async ({ page }) => {
    await reset(page, "wairimu");
    await open(page, harness("wairimu", { intent: "institution" }));
    await expect(checkbox(page, "Find people for your organisation")).toBeChecked();
    await expect(checkbox(page, "Mentor")).not.toBeChecked();
    expect((await state(page, "wairimu")).stage).toBe("NEW");
  });

  test("member and mentor: the request step, its problems, then Pending with no role", async ({ page }) => {
    await reset(page, "wairimu");
    await open(page, harness("wairimu"));
    await card(page, "member").click();
    await card(page, "mentor").click();
    await continueButton(page).click();
    await page.waitForURL(/step=request/);
    await settled(page);
    await expect(heading(page)).toHaveText("A few details for the team");
    await expect(heading(page)).toBeFocused();
    await expect(main(page).getByRole("heading", { name: "Mentor access" })).toBeVisible();
    await expect(main(page).getByRole("heading", { name: "Organisation access" })).toHaveCount(0);
    await expect(main(page).getByRole("heading", { name: "What approval opens" })).toHaveCount(0);
    expect(await state(page, "wairimu")).toMatchObject({ stage: "DONE", intents: ["MEMBER", "MENTOR"], roles: [], requests: [] });

    // Too short, and a link with a password in it: both named, the list takes focus, the words stay.
    await main(page).getByLabel("What kind of work could you review?").fill("Python");
    await main(page).getByLabel("A link that shows your work").fill("https://me:secret@example.org");
    await main(page).getByRole("button", { name: "Send request" }).click();
    await settled(page);
    const problems = main(page).getByRole("alert");
    await expect(problems).toBeFocused();
    await expect(problems.getByRole("link")).toHaveText([
      "Write at least 20 characters about the work you could review.",
      "Enter the address without a username or password.",
    ]);
    await expect(page).toHaveTitle(/^Error: A few details for the team/);
    await expect(main(page).getByLabel("What kind of work could you review?")).toHaveValue("Python");
    await expect(main(page).getByLabel("What kind of work could you review?")).toHaveAttribute("aria-invalid", "true");
    await page.screenshot({ path: evidence("02-request-mentor-problems"), fullPage: true });
    await runAxe(page, test.info(), "request step with problems");
    await problems.getByRole("link").first().click();
    await expect(main(page).getByLabel("What kind of work could you review?")).toBeFocused();

    await main(page).getByLabel("What kind of work could you review?").fill("Backend and data work: SQL, APIs and the tests around them.");
    await main(page).getByLabel("A link that shows your work").fill("example.org/portfolio");
    await main(page).getByRole("button", { name: "Send request" }).click();
    await page.waitForURL((url) => url.pathname === LANDING);
    const after = await state(page, "wairimu");
    expect(after.roles).toEqual([]);
    expect(after.requests).toMatchObject([{ role: "MENTOR", status: "PENDING", note: "Backend and data work: SQL, APIs and the tests around them." }]);
  });

  test("an organisation: what approval opens, and the acknowledgement it needs", async ({ page }) => {
    await reset(page, "wairimu");
    await open(page, harness("wairimu", { intent: "institution" }));
    await continueButton(page).click();
    await page.waitForURL(/step=request/);
    await settled(page);
    const scope = main(page).getByRole("region", { name: "What approval opens" });
    await expect(scope.getByRole("listitem")).toHaveText([
      "Discover: search saved community profiles.",
      "The contributions members share with institutions, with their sources and any mentor confirmations.",
      "Not private cohort recordings, transcripts or internal records.",
      "Not introductions or interviews. Those stay your own next step.",
    ]);
    await main(page).getByLabel("Organisation name").fill("Mto Labs");
    await main(page).getByLabel("Your role there").fill("Engineering lead");
    const explore = "Junior engineers who have built mobile or payments features.";
    await main(page).getByLabel("What would you like to explore?").fill(explore);
    await expect(main(page).locator(".request-field__counter")).toHaveText(`${explore.length} / 600`);
    await page.screenshot({ path: evidence("02-request-institution") });
    await page.screenshot({ path: evidence("02-request-institution-full"), fullPage: true });
    await runAxe(page, test.info(), "request step");
    await expectContained(page);

    await main(page).getByRole("button", { name: "Send request" }).click();
    await settled(page);
    await expect(main(page).getByRole("alert").getByRole("link")).toHaveText(["Confirm what approval opens before sending."]);
    await expect(main(page).getByLabel("Organisation name")).toHaveValue("Mto Labs");
    await main(page).getByRole("checkbox", { name: /^I understand approval/ }).check();
    await main(page).getByRole("button", { name: "Send request" }).click();
    await page.waitForURL((url) => url.pathname === LANDING);
    expect((await state(page, "wairimu")).requests).toMatchObject([{ role: "INSTITUTION", status: "PENDING" }]);
  });

  test("back to your choices keeps them, and a second request step asks only for what is left", async ({ page }) => {
    await reset(page, "wairimu");
    await open(page, harness("wairimu"));
    await card(page, "mentor").click();
    await card(page, "institution").click();
    await continueButton(page).click();
    await page.waitForURL(/step=request/);
    await settled(page);
    await expect(main(page).getByRole("button", { name: "Send requests" })).toBeVisible();
    await main(page).getByRole("link", { name: "Back to your choices" }).click();
    await settled(page);
    await expect(heading(page)).toBeFocused();
    await expect(checkbox(page, "Mentor")).toBeChecked();
    await expect(checkbox(page, "Find people for your organisation")).toBeChecked();
    await expect(checkbox(page, "Build and learn")).not.toBeChecked();
  });

  test("just looking around saves that alone and lands", async ({ page }) => {
    await reset(page, "wairimu");
    await open(page, harness("wairimu"));
    await card(page, "mentor").click();
    await exploreButton(page).click();
    await page.waitForURL((url) => url.pathname === LANDING);
    expect(await state(page, "wairimu")).toMatchObject({ stage: "DONE", intents: ["EXPLORING"], requests: [] });
  });

  test("a revisit shows where requests stand and asks only for a declined one again", async ({ page }) => {
    await reset(page, "mercyAkinyi");
    await open(page, harness("mercyAkinyi"));
    await expect(checkbox(page, "Build and learn")).toBeChecked();
    await expect(checkbox(page, "Mentor")).toBeChecked();
    await expect(card(page, "mentor")).toContainText("Pending");
    await continueButton(page).click();
    await page.waitForURL((url) => url.pathname === LANDING);

    await reset(page, "peter");
    await open(page, harness("peter", { step: "request" }));
    await expect(main(page).getByRole("heading", { name: "Mentor access" })).toBeVisible();
  });

  test("keeps every answer when the server cannot take the request", async ({ page }) => {
    await reset(page, "peter");
    await open(page, harness("peter", { fail: "rate", step: "request" }));
    await main(page).getByLabel("What kind of work could you review?").fill("Data pipelines and the tests around them.");
    await main(page).getByRole("button", { name: "Send request" }).click();
    await settled(page);
    await expect(main(page).getByRole("alert")).toBeFocused();
    await expect(main(page).getByRole("alert")).toHaveText("You’ve sent several requests today. Your answers are still here: try again tomorrow.");
    await expect(main(page).getByLabel("What kind of work could you review?")).toHaveValue("Data pipelines and the tests around them.");
    expect((await state(page, "peter")).requests[0]?.status).toBe("DECLINED");
  });

  test("passes axe on the choices, empty and refused", async ({ page }) => {
    await reset(page, "wairimu");
    await open(page, harness("wairimu"));
    await runAxe(page, test.info(), "welcome step");
    await continueButton(page).click();
    await runAxe(page, test.info(), "welcome step, nothing chosen");
  });

  test("fits and lets every word be read from 320 to 1440 px", async ({ page }) => {
    test.skip(test.info().project.name === "mobile-chromium", "One sweep covers every width.");
    await reset(page, "wairimu");
    for (const width of SWEEP) {
      await page.setViewportSize({ width, height: 860 });
      await open(page, harness("wairimu", { intent: "mentor" }));
      await expectContained(page);
      await installTextTracker(page, "main");
      await walkAndSample(page, { settleMs: 60 });
      const report = await textReport(page);
      const issues = report.issues.filter((issue) => !issue.decorative && !issue.path.includes("sr-only"));
      expect(issues, `welcome at ${width}px`).toEqual([]);
      await open(page, harness("peter", { step: "request" }));
      await expectContained(page);
    }
  });

  test("keeps the phone's actions on screen while the cards scroll", async ({ page }) => {
    test.skip(test.info().project.name !== "mobile-chromium", "The action bar is the phone layout's.");
    await reset(page, "wairimu");
    await open(page, harness("wairimu"));
    const bar = page.locator(".welcome-actions");
    for (const y of [0, 300]) {
      await page.evaluate((top) => window.scrollTo(0, top), y);
      const box = (await bar.boundingBox())!;
      expect(Math.round(box.y + box.height)).toBe(844);
    }
    await expect(continueButton(page)).toBeInViewport();
  });
});

test.describe("without JavaScript (DEV harness)", () => {
  test.skip(Boolean(process.env.PLAYWRIGHT_BASE_URL), "The harness is dev-only and unavailable on deployed environments.");
  test.use({ javaScriptEnabled: false, reducedMotion: "reduce" });

  test("onboards as member and mentor, refused once on the way, with focus where it should be", async ({ page }) => {
    await reset(page, "wairimu");
    await open(page, harness("wairimu"), false);
    await expect(heading(page)).toBeFocused();
    await expect(page.locator(".welcome-actions__count")).toHaveCount(0);
    await continueButton(page).click();
    await settled(page, false);
    await expect(main(page).getByRole("alert")).toHaveText("Choose at least one, or pick ‘I’m just looking around’.");
    await expect(main(page).getByRole("alert")).toBeFocused();
    await card(page, "member").click();
    await card(page, "mentor").click();
    await continueButton(page).click();
    await page.waitForURL(/step=request/);
    await settled(page, false);
    await expect(heading(page)).toBeFocused();
    await main(page).getByLabel("What kind of work could you review?").fill("Too short");
    await main(page).getByRole("button", { name: "Send request" }).click();
    await settled(page, false);
    await expect(main(page).getByRole("alert")).toBeFocused();
    await main(page).getByLabel("What kind of work could you review?").fill("Frontend reviews: accessibility, React and CSS.");
    await main(page).getByRole("button", { name: "Send request" }).click();
    await page.waitForURL((url) => url.pathname === LANDING);
    expect((await state(page, "wairimu")).requests).toMatchObject([{ role: "MENTOR", status: "PENDING" }]);
  });
});

test.describe("motion (DEV harness)", () => {
  test.skip(Boolean(process.env.PLAYWRIGHT_BASE_URL), "The harness is dev-only and unavailable on deployed environments.");

  async function cardMotion(browser: Browser, reducedMotion: "reduce" | "no-preference") {
    const context = await browser.newContext({ reducedMotion, viewport: { width: 1440, height: 900 } });
    const page = await context.newPage();
    await open(page, harness("wairimu"));
    const result = await page.evaluate(() => {
      const el = document.querySelector<HTMLElement>(".welcome-choice")!;
      const check = el.querySelector<HTMLElement>(".welcome-choice__check")!;
      // Each moving part's last moment: its longest duration plus delay.
      const ends = (style: CSSStyleDeclaration) => {
        const seconds = (list: string) => list.split(",").map((value) => Number.parseFloat(value) * 1000);
        const durations = seconds(style.transitionDuration);
        const delays = seconds(style.transitionDelay);
        return Math.max(...durations.map((duration, i) => (duration > 0 ? duration + (delays[i % delays.length] ?? 0) : 0)));
      };
      // Whether the page opts into the sheet transition under these preferences: an @view-transition rule that applies.
      const applies = (rules: CSSRuleList, media: string | null): boolean => Array.from(rules).some((rule) => {
        if (rule instanceof CSSMediaRule) return applies(rule.cssRules, rule.media.mediaText);
        return rule.cssText.startsWith("@view-transition") && (media === null || matchMedia(media).matches);
      });
      return {
        card: ends(getComputedStyle(el)),
        fill: ends(getComputedStyle(check, "::before")),
        tick: ends(getComputedStyle(check.querySelector("svg")!)),
        transition: Array.from(document.styleSheets).some((sheet) => applies(sheet.cssRules, null)),
      };
    });
    await context.close();
    return result;
  }

  test("is a lift under 180 ms with motion, and a cut without it", async ({ browser }) => {
    test.skip(test.info().project.name === "mobile-chromium", "The same stylesheet; one project checks it.");
    const moving = await cardMotion(browser, "no-preference");
    // The edge and lift lead, the fill follows, the tick lands last, and all of it inside 180 ms.
    expect(moving.card).toBeGreaterThan(0);
    expect(moving.fill).toBeGreaterThan(0);
    expect(moving.tick).toBeGreaterThan(moving.fill);
    expect(Math.max(moving.card, moving.fill, moving.tick)).toBeLessThanOrEqual(180);
    expect(moving.transition).toBe(true);
    const still = await cardMotion(browser, "reduce");
    expect(still).toEqual({ card: 0, fill: 0, tick: 0, transition: false });
  });

  test("never moves the cards on arrival", async ({ page }) => {
    test.skip(test.info().project.name === "mobile-chromium", "One project checks arrival.");
    await reset(page, "wairimu");
    await open(page, harness("wairimu"));
    const animations = await page.evaluate(() => document.getAnimations().filter((a) =>
      (a.effect as KeyframeEffect | null)?.target instanceof Element
      && ((a.effect as KeyframeEffect).target as Element).closest(".welcome-choice")).length);
    expect(animations).toBe(0);
  });
});
