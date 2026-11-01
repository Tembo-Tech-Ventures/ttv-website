import { mkdirSync } from "node:fs";
import { expect, test, type Page } from "@playwright/test";
import { runAxe } from "./platform-axe";
import { personaSession, signIn, type PersonaKey } from "./platform-personas";

/**
 * The browser contract for channel sidebars and "How we talk to each other"
 * (U-2.3), on the DEV-only harness `/dev/platform-channels`: the real
 * Community and Cohort sidebars, channel frame and conduct page, fed with
 * fixture channels for synthetic personas; then the same journeys on real
 * sessions, at the bottom.
 */
const HARNESS = "/dev/platform-channels";
const EVIDENCE_DIR = "test-results/evidence/platform-channels";
const SIZES = [
  { width: 1440, height: 900 },
  { width: 390, height: 844 },
] as const;

const COMMUNITY_CHANNELS = ["introductions", "show-your-work", "help", "opportunities", "design-crit"];
const COHORT_04_CHANNELS = ["cohort-04", "c04-help", "c04-announcements"];
const CONDUCT = "How we talk to each other";

function harness(query: string): string {
  return `${HARNESS}?${query}`;
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

async function open(page: Page, query: string) {
  await routeFonts(page);
  const response = await page.goto(harness(query));
  expect(response?.status(), query).toBe(200);
  if (await page.locator("astro-island").count()) await expect(page.locator("astro-island[ssr]")).toHaveCount(0);
  await page.evaluate(() => document.fonts.ready);
}

const wide = (page: Page) => (page.viewportSize()?.width ?? 0) >= 1024;

/** The sidebar, opened as a drawer on a phone. */
async function sidebar(page: Page, space: string) {
  if (!wide(page)) {
    await page.getByRole("link", { name: `Open ${space} menu` }).click();
    await expect(page.getByRole("dialog", { name: `${space} menu` })).toBeVisible();
  }
  return page.locator("#space-sidebar");
}

/** The links of the sidebar's Channels group, by visible name. */
async function channelLinks(page: Page, space: string): Promise<string[]> {
  const list = (await sidebar(page, space)).getByRole("list", { name: "Channels" });
  if (!(await list.count())) return [];
  return list.getByRole("link").locator("[data-sidebar-label]").allTextContents();
}

async function evidence(page: Page, name: string) {
  mkdirSync(EVIDENCE_DIR, { recursive: true });
  await page.screenshot({ path: `${EVIDENCE_DIR}/${name}.png` });
}

test.describe("on a deployed build", () => {
  test.skip(!process.env.PLAYWRIGHT_BASE_URL, "Only deployed builds prove the harness is absent.");

  test("the channels harness does not exist", async ({ page }) => {
    expect((await page.goto(harness("persona=wanjiku")))?.status()).toBe(404);
  });
});

test.describe("channel sidebars and how we talk to each other", () => {
  test.skip(Boolean(process.env.PLAYWRIGHT_BASE_URL), "The harness is dev-only and unavailable on deployed environments.");

  test("a cohort member sees their cohort's channels in Cohort and the community's in Community", async ({ page }) => {
    await open(page, "persona=wanjiku&space=cohort");
    expect(await channelLinks(page, "Cohort")).toEqual(COHORT_04_CHANNELS);
    await open(page, "persona=wanjiku&space=community");
    expect(await channelLinks(page, "Community")).toEqual([...COMMUNITY_CHANNELS, CONDUCT]);
  });

  test("a community-only member sees the community's channels and no cohort's", async ({ page }) => {
    await open(page, "persona=lucy&space=community");
    expect(await channelLinks(page, "Community")).toEqual([...COMMUNITY_CHANNELS, CONDUCT]);
    await expect(page.getByRole("link", { name: /cohort-04|c04-/ })).toHaveCount(0);
    // A cohort channel she cannot read does not exist for her.
    expect((await page.request.get(harness("persona=lucy&channel=cohort-04"))).status()).toBe(404);
  });

  test("an institution user sees and can open the community's channels (owner decision 7)", async ({ page }) => {
    await open(page, "persona=joseph&space=community");
    expect(await channelLinks(page, "Community")).toEqual([...COMMUNITY_CHANNELS, CONDUCT]);
    await open(page, "persona=joseph&channel=introductions&agreed");
    await expect(page.getByRole("heading", { level: 1, name: "introductions" })).toBeVisible();
  });

  test("with channels off the sidebars have no channels, and channel pages do not exist", async ({ page }) => {
    for (const space of ["Community", "Cohort"]) {
      await open(page, `persona=wanjiku&space=${space.toLowerCase()}&channels=off`);
      const bar = await sidebar(page, space);
      await expect(bar.getByRole("list", { name: "Channels" })).toHaveCount(0);
      await expect(bar.getByRole("link", { name: CONDUCT })).toHaveCount(0);
      await expect(bar.locator("[data-emphasis]")).toHaveCount(0);
    }
    for (const query of ["channel=help&agreed", "view=conduct&agreed"]) {
      expect((await page.request.get(harness(`persona=wanjiku&channels=off&${query}`))).status(), query).toBe(404);
    }
  });

  test("unread channels are bold with their count said out loud; read ones are quieter", async ({ page }) => {
    await open(page, "persona=wanjiku&space=community");
    const bar = await sidebar(page, "Community");
    const help = bar.getByRole("link", { name: "help 3 unread messages" });
    await expect(help).toHaveAttribute("data-emphasis", "unread");
    expect(Number(await help.evaluate((link) => getComputedStyle(link).fontWeight))).toBeGreaterThanOrEqual(700);
    const intro = bar.getByRole("link", { name: "introductions", exact: true });
    await expect(intro).toHaveAttribute("data-emphasis", "read");
    expect(Number(await intro.evaluate((link) => getComputedStyle(link).fontWeight))).toBeLessThan(600);
  });

  test("the first channel shows the habits; agreeing opens the channel, marked current, and keeps the query", async ({ page }) => {
    await open(page, "persona=lucy&channel=help");
    const gate = page.locator("[data-conduct-gate]");
    await expect(gate.getByRole("heading", { level: 2, name: CONDUCT })).toBeVisible();
    await expect(gate.locator("[data-conduct-habit]")).toHaveCount(6);
    await expect(page.locator("[data-channel-not-open]")).toHaveCount(0);

    // Keyboard: the one action is reachable and works with Enter.
    const agree = page.getByRole("button", { name: "I’ll keep to this" });
    await agree.focus();
    await page.keyboard.press("Enter");
    await page.waitForURL((url) => url.searchParams.has("agreed") && url.searchParams.get("channel") === "help");
    await expect(page.locator("[data-conduct-gate]")).toHaveCount(0);
    await expect(page.getByRole("heading", { level: 2, name: "Conversations aren’t open yet" })).toBeVisible();
    const bar = await sidebar(page, "Community");
    await expect(bar.locator('[aria-current="page"]')).toHaveText(/help/);
  });

  test("agreeing works without JavaScript", async ({ browser, baseURL }) => {
    const context = await browser.newContext({ javaScriptEnabled: false, baseURL });
    const page = await context.newPage();
    await page.goto(harness("persona=wanjiku&channel=c04-help"));
    await page.getByRole("button", { name: "I’ll keep to this" }).click();
    await expect(page.getByRole("heading", { level: 2, name: "Conversations aren’t open yet" })).toBeVisible();
    expect(new URL(page.url()).searchParams.get("channel")).toBe("c04-help");
    await context.close();
  });

  test("refuses an agreement posted from another site", async ({ page, baseURL }) => {
    const response = await page.request.post(harness("persona=lucy&channel=help"), {
      form: { intent: "conduct", version: "1" }, headers: { origin: "https://elsewhere.example" }, maxRedirects: 0,
    });
    // Astro's own origin check answers first; the flow would refuse it too.
    expect(response.status(), String(baseURL)).toBe(403);
  });

  test("the habits are always there to read again, with the day you agreed", async ({ page }) => {
    await open(page, "persona=lucy&view=conduct&agreed");
    await expect(page.getByRole("heading", { level: 1, name: CONDUCT })).toBeVisible();
    await expect(page.locator("[data-conduct-agreed]")).toHaveText("You agreed to this on 3 Nov 2026.");
    await expect(page.getByRole("button", { name: "I’ll keep to this" })).toHaveCount(0);
    const bar = await sidebar(page, "Community");
    await expect(bar.locator('[aria-current="page"]')).toHaveText(CONDUCT);

    // Someone who arrives before any channel can agree here, and stays on the page.
    await open(page, "persona=lucy&view=conduct");
    await page.getByRole("button", { name: "I’ll keep to this" }).click();
    await expect(page.locator("[data-conduct-agreed]")).toBeVisible();
  });

  test("Mattone appears once at most: the conduct page's title, never a channel's", async ({ page }) => {
    const mattone = (selector: string) => page.locator(selector).evaluateAll((nodes) => nodes.filter((node) => getComputedStyle(node).fontFamily.includes("Mattone")).length);
    await open(page, "persona=lucy&view=conduct&agreed");
    expect(await mattone("#spaces-main h1, #spaces-main h2")).toBe(1);
    for (const query of ["persona=lucy&channel=help", "persona=lucy&channel=help&agreed"]) {
      await open(page, query);
      expect(await mattone("#spaces-main h1, #spaces-main h2"), query).toBe(0);
    }
  });

  test("the cohort's channels say who reads them and who posts", async ({ page }) => {
    await open(page, "persona=wanjiku&channel=c04-announcements&agreed");
    const about = page.getByRole("list", { name: "About this channel" });
    await expect(about.getByRole("listitem")).toHaveText(["Cohort only", "Staff post here"]);
    await open(page, "persona=wanjiku&channel=help&agreed");
    await expect(page.getByRole("list", { name: "About this channel" }).getByRole("listitem")).toHaveText(["Everyone signed in"]);
  });

  for (const size of SIZES) {
    test(`passes axe at WCAG 2.2 A and AA with no sideways scrolling, at ${size.width}px`, async ({ page }, testInfo) => {
      test.setTimeout(120_000);
      await page.setViewportSize(size);
      const views = [
        ["community", "persona=wanjiku&space=community", "Community"],
        ["cohort", "persona=wanjiku&space=cohort", "Cohort"],
        ["gate", "persona=wanjiku&channel=help", "Community"],
        ["channel", "persona=wanjiku&channel=c04-announcements&agreed", "Cohort"],
        ["conduct", "persona=joseph&view=conduct", "Community"],
      ] as const;
      for (const [name, query, space] of views) {
        await open(page, query);
        await runAxe(page, testInfo, `${name}-${size.width}`);
        expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), `${name} scrolls sideways`).toBe(true);
        await evidence(page, `${name}-${size.width}`);
        if (size.width < 1024) {
          await sidebar(page, space);
          await runAxe(page, testInfo, `${name}-drawer-${size.width}`);
          await evidence(page, `${name}-drawer-${size.width}`);
        }
      }
    });
  }

  test("every sidebar channel is a 44px target on a touch screen", async ({ page }, testInfo) => {
    test.skip(!testInfo.project.name.includes("mobile"), "Touch sizing applies to coarse pointers.");
    await open(page, "persona=wanjiku&space=community");
    const links = (await sidebar(page, "Community")).getByRole("list", { name: "Channels" }).getByRole("link");
    for (const box of await links.evaluateAll((nodes) => nodes.map((node) => node.getBoundingClientRect().height))) {
      expect(box).toBeGreaterThanOrEqual(44);
    }
  });
});

/*
 * The same journeys on real sessions: the routes, the backend's channel list
 * (B-2.2) and the conduct store. Locally against platform-personas.local.sql
 * (see platform-personas.spec.ts for the setup); on agent previews against
 * the preview's personas, whose sessions are agents' delegated sessions, so
 * agreeing to the habits (a person's own act) is checked locally only.
 */
test.describe("channels on real sessions", () => {
  const LOCAL = !process.env.PLAYWRIGHT_BASE_URL;
  const COHORT_SLUG = /^(?:cohort-\d{2,}|c\d{2,}-help|c\d{2,}-announcements)$/;

  async function as(page: Page, context: import("@playwright/test").BrowserContext, baseURL: string, key: PersonaKey) {
    const session = personaSession(key);
    test.skip(typeof session === "string", typeof session === "string" ? session : "");
    if (typeof session === "string") return;
    await routeFonts(page);
    await signIn(context, baseURL, session);
    const me = await page.request.get("/api/platform/me");
    test.skip(me.status() === 404, "The spaces flag is off here.");
    const flags = (await me.json()) as { flags?: { channels?: boolean } };
    test.skip(!flags.flags?.channels, "The channels flag is off here; the harness covers the flag-off sidebar.");
  }

  async function openReal(page: Page, path: string) {
    const response = await page.goto(path);
    expect(response?.status(), path).toBe(200);
    if (LOCAL) await page.addStyleTag({ content: "astro-dev-toolbar { display: none !important; }" });
    await expect(page.locator("astro-island[ssr]")).toHaveCount(0);
  }

  test.beforeEach(async ({ page }, testInfo) => {
    await page.setViewportSize(testInfo.project.name === "mobile-chromium" ? { width: 390, height: 844 } : { width: 1440, height: 900 });
  });

  test("a cohort member sees their cohort's channels in Cohort and the community's in Community", async ({ page, context, baseURL }, testInfo) => {
    await as(page, context, baseURL!, "student");
    await openReal(page, "/dashboard/cohort");
    const slugs = await channelLinks(page, "Cohort");
    expect(slugs.length).toBeGreaterThan(0);
    for (const slug of slugs) expect(slug).toMatch(COHORT_SLUG);
    if (LOCAL) expect(slugs).toEqual(["cohort-05", "c05-help", "c05-announcements"]);
    await runAxe(page, testInfo, "student-cohort");

    await openReal(page, "/dashboard/community");
    expect(await channelLinks(page, "Community")).toEqual([...COMMUNITY_CHANNELS, CONDUCT]);

    // Its cohort channel opens in Cohort, with its header and either the habits or the not-open note.
    await openReal(page, `/dashboard/cohort/c/${slugs[0]}`);
    await expect(page.getByRole("heading", { level: 1, name: slugs[0] })).toBeVisible();
    await expect(page.locator("[data-conduct-gate], [data-channel-not-open]")).toHaveCount(1);
    await runAxe(page, testInfo, "student-channel");
    await page.screenshot({ path: `${EVIDENCE_DIR}/real-student-channel-${testInfo.project.name}.png` });
  });

  test("a community-only member sees the community's channels, and no cohort's channel exists for them", async ({ page, context, baseURL }) => {
    await as(page, context, baseURL!, "community");
    await openReal(page, "/dashboard/community");
    expect(await channelLinks(page, "Community")).toEqual([...COMMUNITY_CHANNELS, CONDUCT]);
    if (LOCAL) expect((await page.request.get("/dashboard/cohort/c/cohort-05", { maxRedirects: 0 })).status()).toBe(404);
  });

  test("an institution user sees and opens the community's channels (owner decision 7)", async ({ page, context, baseURL }, testInfo) => {
    await as(page, context, baseURL!, "institution");
    await openReal(page, "/dashboard/community");
    expect(await channelLinks(page, "Community")).toEqual([...COMMUNITY_CHANNELS, CONDUCT]);
    await openReal(page, "/dashboard/community/c/introductions");
    await expect(page.getByRole("heading", { level: 1, name: "introductions" })).toBeVisible();
    await runAxe(page, testInfo, "institution-channel");
  });

  test("the first channel asks; agreeing is kept, opens the channel and dates the habits page", async ({ page, context, baseURL }) => {
    test.skip(!LOCAL, "Preview personas are agents' delegated sessions, which may read but never agree for a person.");
    test.skip(test.info().project.name !== "chromium", "One project writes; the persona is shared.");
    // Four pages, one of them a post: a cold dev server compiles each the first time.
    test.setTimeout(90_000);
    await as(page, context, baseURL!, "alumna");
    await openReal(page, "/dashboard/cohort/c/c04-help");
    await expect(page.locator("[data-conduct-gate]")).toBeVisible();
    await page.getByRole("button", { name: "I’ll keep to this" }).click();
    await expect(page.getByRole("heading", { level: 2, name: "Conversations aren’t open yet" })).toBeVisible();
    expect(new URL(page.url()).pathname).toBe("/dashboard/cohort/c/c04-help");

    // Kept: another channel opens straight away, and the habits page says when.
    await openReal(page, "/dashboard/community/c/help");
    await expect(page.locator("[data-conduct-gate]")).toHaveCount(0);
    await openReal(page, "/dashboard/community/conduct");
    await expect(page.locator("[data-conduct-agreed]")).toHaveText(/^You agreed to this on \d{1,2} \w{3} \d{4}\.$/);
  });
});
