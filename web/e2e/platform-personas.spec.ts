import { mkdirSync } from "node:fs";
import { expect, test, type Page } from "@playwright/test";
import { runAxe } from "./platform-axe";
import { assertPersonaOrigin, PERSONA_EXPECTATIONS, personaSession, signIn, type PersonaKey } from "./platform-personas";
import { FIXTURE_ENVIRONMENT } from "./fixture-env";

/**
 * U-1.2: the existing pages inside the spaces shell, as each kind of person
 * meets them. For every persona: where /dashboard opens, which spaces they
 * have, and, in each space, that the page renders in the shell with one h1,
 * its sidebar entry current, every sidebar link leading somewhere real, no
 * sideways scrolling, and no axe A/AA violations. Then the journeys that
 * matter most: a member without a cohort finds a visible way to apply; Ask
 * Tembo fills the sheet; mentoring says what is not open yet; staff keep the
 * admin entry; forms still post inside the shell.
 *
 * Desktop runs at 1440x900 (chromium project), phones at 390x844 (mobile).
 * Sessions are cookies, as in a real browser (see platform-personas.ts).
 * Locally: seed e2e/platform-personas.local.sql, run astro dev with
 * PLATFORM_FLAGS_OVERRIDE=all, and set PLATFORM_PERSONAS_LOCAL_SECRET.
 */

const EVIDENCE_DIR = "test-results/evidence/platform-personas";
mkdirSync(EVIDENCE_DIR, { recursive: true });

const SPACE_HOME: Record<string, string> = {
  Cohort: "/dashboard/cohort",
  Community: "/dashboard/community",
  Mentoring: "/dashboard/mentoring",
  Discover: "/dashboard/discover",
  Admin: "/admin",
  Profile: "/dashboard/me",
};

const SPACE_LABEL: Record<string, string> = Object.fromEntries(Object.keys(SPACE_HOME).map((label) => [label.toLowerCase(), label]));

const PERSONAS = Object.keys(PERSONA_EXPECTATIONS) as PersonaKey[];

test.use({ reducedMotion: "reduce" });
test.beforeEach(async ({ page }, testInfo) => {
  if (testInfo.project.name === "mobile-chromium") await page.setViewportSize({ width: 390, height: 844 });
  else await page.setViewportSize({ width: 1440, height: 900 });
});

function wide(page: Page) {
  return (page.viewportSize()?.width ?? 0) >= 1024;
}

function evidence(name: string) {
  return `${EVIDENCE_DIR}/${test.info().project.name}-${name}.png`;
}

/** Routes Google Fonts through Node, which can reach them when the browser in a dev container cannot. */
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

async function open(page: Page, path: string) {
  const response = await page.goto(path);
  expect(response?.status(), path).toBe(200);
  await expect(page.locator("astro-island[ssr]")).toHaveCount(0);
  // astro dev's toolbar sits over the bottom bar in local evidence.
  if (!process.env.PLAYWRIGHT_BASE_URL) await page.addStyleTag({ content: "astro-dev-toolbar { display: none !important; }" });
  await page.evaluate(() => document.fonts.ready);
  return response;
}

/** The space tabs a person sees at this width. */
async function tabLabels(page: Page) {
  return page.locator(wide(page) ? ".space-file__nav .space-tab__label" : ".spaces-bottom .spaces-bottom__label").allTextContents();
}

async function expectNoSidewaysScroll(page: Page, where: string) {
  const overflow = await page.evaluate(() => {
    const main = document.querySelector<HTMLElement>("#spaces-main");
    return {
      document: document.documentElement.scrollWidth - window.innerWidth,
      main: main ? main.scrollWidth - main.clientWidth : 0,
    };
  });
  expect(overflow, where).toEqual({ document: 0, main: 0 });
}

/** The sidebar's destinations, without fragments, in order. */
async function sidebarPaths(page: Page): Promise<string[]> {
  const hrefs = await page.locator("#space-sidebar a[href]:not([data-drawer-close])").evaluateAll((links) =>
    links.map((link) => link.getAttribute("href")!),
  );
  return [...new Set(hrefs.map((href) => href.split("#", 1)[0]!))];
}

/** One page inside the shell: its space, one display heading, its sidebar entry current, readable and reachable. */
async function expectSpacePage(page: Page, path: string, space: string, name: string) {
  await open(page, path);
  const where = `${name} at ${page.viewportSize()!.width}px`;
  await expect(page.locator(".spaces-shell"), where).toHaveAttribute("data-space", space);
  await expect(page.locator(".space-file__nav [aria-current='page'], .spaces-bottom [aria-current='page']").first()).toContainText(SPACE_LABEL[space]!);
  // The page's one display heading. The community workspaces draw theirs once they load.
  // A cold worker can take a while to answer the workspace APIs.
  await expect(page.locator("#spaces-main h1"), where).toHaveCount(1, { timeout: 30_000 });
  await expect(page.locator("#space-sidebar a[aria-current='page']"), where).toHaveCount(1);
  await expect(page.getByText("We could not open this workspace.")).toHaveCount(0);
  await expect(page.getByRole("link", { name: "Dashboard ↗" })).toHaveCount(0);
  // Nothing moves for someone who asked for reduced motion.
  expect(await page.evaluate(() => document.getAnimations().filter((animation) => animation.playState === "running").length), where).toBe(0);
  await expectNoSidewaysScroll(page, where);
  await runAxe(page, test.info(), name);
  await page.screenshot({ path: evidence(name) });
}

test("mints persona sessions only for localhost or this run's agent preview", () => {
  const preview = { PLAYWRIGHT_BASE_URL: "x", EXPECTED_DEPLOYMENT_ENVIRONMENT: "agent-pr-250" };
  expect(() => assertPersonaOrigin("https://ttv-website-agent-pr-250.tembo.workers.dev", preview)).not.toThrow();
  expect(() => assertPersonaOrigin("http://127.0.0.1:4321", {})).not.toThrow();
  for (const [url, environment] of [
    ["https://tembotechventures.com", preview],
    ["https://staging.tembotechventures.com", { ...preview, EXPECTED_DEPLOYMENT_ENVIRONMENT: "staging" }],
    ["https://ttv-website-agent-pr-251.tembo.workers.dev", preview],
    ["https://ttv-website-agent-pr-250.tembo.workers.dev.example.com", preview],
    ["http://ttv-website-agent-pr-250.tembo.workers.dev", preview],
    ["https://ttv-website-production.tembo.workers.dev", { ...preview, EXPECTED_DEPLOYMENT_ENVIRONMENT: "production" }],
    ["http://127.0.0.1:4321", preview],
  ] as const) {
    expect(() => assertPersonaOrigin(url, environment), url).toThrow();
  }
});

for (const key of PERSONAS) {
  test.describe(`spaces for the ${key} persona`, () => {
    const session = personaSession(key);
    test.skip(typeof session === "string", typeof session === "string" ? session : "");
    const expected = PERSONA_EXPECTATIONS[key];

    test.beforeEach(async ({ context, page, baseURL }) => {
      if (typeof session === "string") return;
      await routeFonts(page);
      await signIn(context, baseURL!, session);
      const me = await page.request.get("/api/platform/me");
      test.skip(me.status() === 404, "The spaces flag is off here; the existing dashboard is covered by its own specs.");
      expect(me.status()).toBe(200);
    });

    test("lands in the right space and renders every page its spaces offer inside the shell", async ({ page, baseURL }) => {
      // Every page of every space, each with axe: a long walk.
      test.setTimeout(300_000);
      await open(page, "/dashboard");
      expect(new URL(page.url()).pathname).toBe(expected.landing);
      expect(await tabLabels(page)).toEqual(expected.spaces);

      const seen = new Set<string>();
      for (const label of expected.spaces) {
        const home = SPACE_HOME[label]!;
        const space = label.toLowerCase();
        if (label === "Admin") {
          // The admin entry: the tab leads to the existing admin pages, which keep their own shell.
          await expect(page.locator(`.space-file__nav a[href="${home}"], .spaces-bottom a[href="${home}"]`).first()).toBeAttached();
          const admin = await page.request.get(home, { maxRedirects: 0 });
          expect(admin.status(), "admin entry").toBe(200);
          continue;
        }
        await expectSpacePage(page, home, space, `${key}-${space}`);
        seen.add(home);
        // Every page the space's sidebar offers renders too: no orphan links.
        for (const path of await sidebarPaths(page)) {
          if (seen.has(path)) continue;
          seen.add(path);
          if (!path.startsWith("/dashboard/")) {
            // Public pages (directories, certificates) and the admin entry keep their own frames.
            const response = await page.request.get(path);
            expect(response.status(), `${key} ${label}: ${path}`).toBeLessThan(400);
            continue;
          }
          await expectSpacePage(page, path, space, `${key}-${path.slice("/dashboard/".length).replaceAll("/", "-")}`);
        }
      }
      expect(new URL(page.url()).origin).toBe(new URL(baseURL!).origin);
    });

    test("reaches the page by keyboard and opens the space's sidebar on a phone", async ({ page }) => {
      await open(page, expected.landing);
      await page.keyboard.press("Tab");
      await expect(page.locator(":focus")).toHaveText("Skip to content");
      await page.keyboard.press("Enter");
      await expect(page.locator("#spaces-main")).toBeFocused();
      if (wide(page)) {
        await expect(page.locator("#space-sidebar a[aria-current='page']")).toBeVisible();
        return;
      }
      const opener = page.getByRole("link", { name: /^Open .+ menu$/ });
      await opener.click();
      await expect(page.locator("#space-sidebar")).toHaveAttribute("role", "dialog");
      await expect(page.locator("#space-sidebar a[aria-current='page']")).toBeVisible();
      await page.keyboard.press("Escape");
      await expect(page.locator("#space-sidebar")).not.toHaveAttribute("role", "dialog");
    });
  });
}

test.describe("a member without a cohort", () => {
  const session = personaSession("community");
  test.skip(typeof session === "string", typeof session === "string" ? session : "");

  test("sees a way to apply on the community page itself and can open the form", async ({ context, page, baseURL }) => {
    if (typeof session === "string") return;
    await routeFonts(page);
    await signIn(context, baseURL!, session);
    test.skip((await page.request.get("/api/platform/me")).status() === 404, "The spaces flag is off here.");

    await open(page, "/dashboard");
    expect(new URL(page.url()).pathname).toBe("/dashboard/community");
    // Their own journey loads for a browser session.
    await expect(page.getByRole("heading", { level: 1 })).toContainText("Your work.");

    // Visible without opening any menu, at either width.
    const invitation = page.locator("[data-cohort-invitation]");
    await expect(invitation).toBeInViewport();
    const apply = invitation.getByRole("link");
    await expect(apply).toBeVisible();
    await page.screenshot({ path: evidence("community-apply-entry") });
    await apply.click();

    await expect(page).toHaveURL(/\/dashboard\/cohort\/apply$/);
    await expect(page.getByRole("heading", { level: 1, name: "Apply to a Cohort" })).toBeVisible();
    // Still in Community: they have no Cohort space until they apply.
    await expect(page.locator(".spaces-shell")).toHaveAttribute("data-space", "community");
    await expect(page.locator("#space-sidebar a[aria-current='page']")).toHaveText("Apply to a cohort");
    const cohorts = page.locator("[data-cohort-id]");
    if ((await cohorts.count()) > 0) {
      await expect(cohorts.first().getByRole("button", { name: "Apply", exact: true })).toBeEnabled();
    } else {
      // Either nothing is open, or they have applied to everything that is.
      await expect(page.locator("[data-apply-empty]")).toHaveText(/No cohorts are accepting applications right now\.|You've applied to every cohort that's open right now\./);
    }
    await page.screenshot({ path: evidence("community-apply-form") });
  });

  test("has Ask Tembo in Community, filling the sheet", async ({ context, page, baseURL }) => {
    if (typeof session === "string") return;
    await routeFonts(page);
    await signIn(context, baseURL!, session);
    test.skip((await page.request.get("/api/platform/me")).status() === 404, "The spaces flag is off here.");

    await open(page, "/dashboard/cohort/ask");
    await expect(page.locator(".spaces-shell")).toHaveAttribute("data-space", "community");
    await expect(page.locator("#space-sidebar a[aria-current='page']")).toHaveText("Ask Tembo");
    await expect(page.getByRole("heading", { name: "Ask Tembo" })).toBeVisible();
    const composer = page.getByPlaceholder("Ask about your sessions…");
    await expect(composer).toBeInViewport();
    // The chat fills the sheet: neither the document nor the sheet scrolls; the transcript does.
    const overflow = await page.evaluate(() => {
      const main = document.querySelector<HTMLElement>("#spaces-main")!;
      return [document.documentElement.scrollHeight - window.innerHeight, main.scrollHeight - main.clientHeight];
    });
    expect(overflow).toEqual([0, 0]);
    await expect(page.getByRole("link", { name: /Back to dashboard/ })).toHaveCount(0);
    await page.screenshot({ path: evidence("community-ask-tembo") });
  });
});

test.describe("a cohort member", () => {
  const session = personaSession("student");
  test.skip(typeof session === "string", typeof session === "string" ? session : "");

  test("keeps sessions and Ask Tembo in the Cohort space, and forms post inside the shell", async ({ context, page, baseURL }) => {
    if (typeof session === "string") return;
    await routeFonts(page);
    await signIn(context, baseURL!, session);
    test.skip((await page.request.get("/api/platform/me")).status() === 404, "The spaces flag is off here.");

    await open(page, "/dashboard/cohort/sessions");
    await expect(page.getByRole("heading", { level: 1, name: "Sessions" })).toBeVisible();
    await expect(page.locator("#space-sidebar a[aria-current='page']")).toHaveText("Sessions");

    await open(page, "/dashboard/cohort/ask");
    await expect(page.locator("#space-sidebar a[aria-current='page']")).toHaveText("Ask Tembo");
    await expect(page.getByPlaceholder("Ask about your sessions…")).toBeInViewport();
    await page.screenshot({ path: evidence("student-ask-tembo") });

    // An old link still lands on the page, now in its space.
    await open(page, "/dashboard/profile");
    expect(new URL(page.url()).pathname).toBe("/dashboard/account");
    await expect(page.getByRole("heading", { level: 1, name: "Account" })).toBeVisible();

    test.skip(!FIXTURE_ENVIRONMENT && Boolean(process.env.PLAYWRIGHT_BASE_URL), "Form posts run only against isolated previews or the local seed.");
    // The avatar action with no file proves the body reached the page handler, without writing anything.
    const posted = await page.request.post("/dashboard/account", {
      form: { action: "avatar" },
      headers: { Origin: new URL(baseURL!).origin },
      maxRedirects: 0,
    });
    expect(posted.status()).toBe(200);
    const html = await posted.text();
    expect(html).toContain("Please choose an image to upload.");
    expect(html).toContain('class="spaces-shell"');
  });
});

test.describe("a mentor", () => {
  const session = personaSession("mentor");
  test.skip(typeof session === "string", typeof session === "string" ? session : "");

  test("sees confirmations, and requests and availability labelled as not open yet", async ({ context, page, baseURL }) => {
    if (typeof session === "string") return;
    await routeFonts(page);
    await signIn(context, baseURL!, session);

    await open(page, "/dashboard/mentoring");
    await expect(page.getByRole("heading", { level: 1, name: "Mentoring" })).toBeVisible();
    for (const name of ["Requests", "Availability"]) {
      const section = page.getByRole("region", { name });
      await expect(section).toContainText("Not open yet");
    }
    await page.getByRole("link", { name: "Review shared work" }).click();
    await expect(page).toHaveURL(/\/dashboard\/mentoring\/confirm$/);
    await expect(page.locator("#space-sidebar a[aria-current='page']")).toHaveText("Confirm work");
    await expect(page.getByRole("heading", { name: "Confirm what you have personally checked" })).toBeVisible();
    // The old mentor link still works and lands on the review.
    await open(page, "/dashboard/mentorship");
    expect(new URL(page.url()).pathname).toBe("/dashboard/mentoring/confirm");
  });
});

test.describe("an institution", () => {
  const session = personaSession("institution");
  test.skip(typeof session === "string", typeof session === "string" ? session : "");

  test("opens the Discover workspace inside its space", async ({ context, page, baseURL }) => {
    if (typeof session === "string") return;
    await routeFonts(page);
    await signIn(context, baseURL!, session);

    await open(page, "/dashboard/discover");
    await expect(page.getByRole("heading", { level: 1, name: "Find the person. See the work." })).toBeVisible();
    await expect(page.locator("#space-sidebar a[aria-current='page']")).toHaveText("Discover people");
    // An institution has no Cohort space, so Community offers the way to apply like any member.
    await open(page, "/dashboard/community");
    await expect(page.locator("[data-cohort-invitation]")).toBeVisible();
  });
});

test.describe("staff", () => {
  const session = personaSession("staff");
  test.skip(typeof session === "string", typeof session === "string" ? session : "");

  test("keep the mentor review in the Admin space without becoming mentors", async ({ context, page, baseURL }) => {
    if (typeof session === "string") return;
    await routeFonts(page);
    await signIn(context, baseURL!, session);
    const me = await page.request.get("/api/platform/me");
    test.skip(me.status() === 404, "The spaces flag is off here.");
    const { capabilities, spaces } = (await me.json()) as { spaces: string[]; capabilities: { isMentor: boolean } };
    test.skip(capabilities.isMentor, "This staff persona is also a mentor.");
    expect(spaces).not.toContain("mentoring");

    await open(page, "/dashboard/mentoring");
    await expect(page.locator(".spaces-shell")).toHaveAttribute("data-space", "admin");
    await expect(page.locator("#space-sidebar a[aria-current='page']")).toHaveText("Mentor review");
    await expect(page.locator("#space-sidebar a", { hasText: "Admin home" })).toHaveAttribute("href", "/admin");
  });
});

test.describe("without JavaScript", () => {
  const session = personaSession("community");
  test.skip(typeof session === "string", typeof session === "string" ? session : "");
  test.use({ javaScriptEnabled: false });

  test("a member without a cohort still lands in Community and reaches the application form", async ({ context, page, baseURL }) => {
    if (typeof session === "string") return;
    await signIn(context, baseURL!, session);
    test.skip((await page.request.get("/api/platform/me")).status() === 404, "The spaces flag is off here.");

    const landing = await page.goto("/dashboard");
    expect(landing?.status()).toBe(200);
    expect(new URL(page.url()).pathname).toBe("/dashboard/community");
    const apply = page.locator("[data-cohort-invitation] a");
    await expect(apply).toBeVisible();
    await page.goto((await apply.getAttribute("href"))!);
    expect(new URL(page.url()).pathname).toBe("/dashboard/cohort/apply");
    await expect(page.getByRole("heading", { level: 1, name: "Apply to a Cohort" })).toBeVisible();
    // The application is a plain form: it posts without any script.
    const forms = page.locator("[data-cohort-id] form[method='POST']");
    if ((await forms.count()) > 0) await expect(forms.first().locator("button[type='submit']")).toBeVisible();
  });
});
