import { mkdirSync } from "node:fs";
import { expect, test, type Page } from "@playwright/test";
import { runAxe } from "./platform-axe";
import { personaSession, signIn, type PersonaKey } from "./platform-personas";

/**
 * The public partner pages' CTAs into onboarding (U-O.4, onboarding SPEC §3).
 *
 * "For mentors" and "For institutions" send people to `/auth/login?next=/dashboard/welcome?intent=…`.
 * Sign-in keeps that path, and only a same-origin one. After it:
 * - onboarding off: B-O.4 sends the hint on to the page the CTA used to open
 *   (/dashboard/mentorship, /dashboard/discover), which explains the approval requirement;
 * - onboarding on: the welcome step opens with that card chosen and nothing sent, or, when the
 *   role is already held, the space it opened.
 *
 * Signed-out checks run anywhere. Signed-in ones use the local seed's personas
 * (platform-personas.local.sql), or an isolated preview's, whose sessions are delegated agent
 * sessions that the welcome step itself refuses: there only the redirects are checked.
 */
const EVIDENCE_DIR = "test-results/evidence/platform-partner-ctas";
mkdirSync(EVIDENCE_DIR, { recursive: true });
const PREVIEW = Boolean(process.env.PLAYWRIGHT_BASE_URL);

const PARTNERS = [
  { page: "/community/mentors", intent: "mentor", legacy: "/dashboard/mentorship", space: "/dashboard/mentoring", holder: "mentor", card: "Mentor" },
  { page: "/community/institutions", intent: "institution", legacy: "/dashboard/discover", space: "/dashboard/discover", holder: "institution", card: "Find people for your organisation" },
] as const;

const welcome = (intent: string) => `/dashboard/welcome?intent=${intent}`;
const signInLink = (intent: string) => `/auth/login?next=${encodeURIComponent(welcome(intent))}`;
const main = (page: Page) => page.locator("main");
const partnerCtas = (page: Page) => page.locator("[data-community-root] a.audience-button");

test.beforeEach(({ baseURL }) => {
  test.skip(baseURL === "http://127.0.0.1:4322", "Requires the real Astro routes and middleware, not the component harness.");
});

/** The path a sign-in page will return to: the GitHub button's callback, as the server rendered it. */
async function signInReturnPath(page: Page, next: string): Promise<string> {
  await page.goto(`/auth/login?next=${encodeURIComponent(next)}`);
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Sign in to Tembo.");
  const props = await page.locator("astro-island[component-url*='GitHubSignInButton']").getAttribute("props");
  const callback = (JSON.parse(props ?? "{}") as { callbackURL?: [number, string] }).callbackURL;
  return callback?.[1] ?? "";
}

/** Same-origin paths only: anything that could leave the site falls back to /dashboard (lib/auth/next-path). */
const HOSTILE_NEXT = [
  "https://evil.example/dashboard/welcome?intent=mentor",
  "//evil.example/dashboard/welcome?intent=mentor",
  "/\\evil.example",
  "\\\\evil.example",
  "%2F%2Fevil.example",
  "/%2F%2Fevil.example",
  "javascript:alert(1)",
  "dashboard/welcome?intent=mentor",
];

test.describe("signed out", () => {
  for (const partner of PARTNERS) {
    test(`${partner.page} sends both CTAs through sign-in to the ${partner.intent} welcome hint`, async ({ page }) => {
      await page.goto(partner.page);
      await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
      const ctas = partnerCtas(page);
      await expect(ctas).toHaveCount(2);
      for (const cta of await ctas.all()) await expect(cta).toHaveAttribute("href", signInLink(partner.intent));
      await ctas.first().click();
      await expect(page).toHaveURL(new URL(signInLink(partner.intent), page.url()).href);
      await expect(page.getByRole("heading", { level: 1 })).toHaveText("Sign in to Tembo.");
      expect(await signInReturnPath(page, welcome(partner.intent))).toBe(welcome(partner.intent));
    });
  }

  test("sign-in returns only to same-origin paths", async ({ page }) => {
    for (const next of HOSTILE_NEXT) expect(await signInReturnPath(page, next), next).toBe("/dashboard");
  });

  for (const partner of PARTNERS) {
    test(`${partner.page} passes axe A/AA, fits the viewport and is captured at 390 and 1440`, async ({ page }) => {
      test.skip(test.info().project.name !== "chromium", "Both widths are set explicitly; one project captures them.");
      await page.emulateMedia({ reducedMotion: "reduce" });
      for (const viewport of [{ width: 390, height: 844 }, { width: 1440, height: 900 }]) {
        await page.setViewportSize(viewport);
        await page.goto(partner.page);
        await page.evaluate(() => document.fonts.ready);
        // The page's own content. PublicLayout's logo link has a pre-existing label-in-name
        // mismatch shared by every public page, reported separately.
        await runAxe(page, test.info(), `${partner.intent}-${viewport.width}`, { include: ["main"] });
        expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
        const flow = await page.locator("[data-community-root]").getAttribute("data-access-flow");
        const name = `${partner.intent}-${flow}-${viewport.width}`;
        await page.screenshot({ path: `${EVIDENCE_DIR}/${name}-hero.png`, animations: "disabled" });
        const faq = page.locator(".audience-questions");
        await faq.locator("details").nth(partner.intent === "mentor" ? 1 : 0).locator("summary").click();
        await faq.scrollIntoViewIfNeeded();
        await page.screenshot({ path: `${EVIDENCE_DIR}/${name}-faq.png`, animations: "disabled" });
      }
    });
  }
});

test.describe("signed in", () => {
  /** Signs a persona in, and says whether onboarding is on for them, from their own Me. */
  async function signedIn(page: Page, baseURL: string | undefined, key: PersonaKey): Promise<boolean> {
    const persona = personaSession(key);
    test.skip(typeof persona === "string", typeof persona === "string" ? persona : "");
    if (typeof persona === "string") return false;
    await signIn(page.context(), baseURL!, persona);
    const me = await page.request.get("/api/platform/me");
    const on = me.status() === 200 && ((await me.json()) as { flags: { onboarding?: boolean } }).flags.onboarding === true;
    test.info().annotations.push({ type: "onboarding", description: on ? "on" : "off" });
    return on;
  }

  async function location(page: Page, path: string): Promise<string | undefined> {
    const response = await page.request.get(path, { maxRedirects: 0 });
    expect(response.status(), path).toBe(302);
    return response.headers().location;
  }

  test("sign-in sends a signed-in person straight on, and only to same-origin paths", async ({ page, baseURL }) => {
    await signedIn(page, baseURL, "community");
    for (const partner of PARTNERS) expect(await location(page, signInLink(partner.intent))).toBe(welcome(partner.intent));
    for (const next of HOSTILE_NEXT) expect(await location(page, `/auth/login?next=${encodeURIComponent(next)}`), next).toBe("/dashboard");
  });

  test("with onboarding off, each CTA still reaches the page it opened before", async ({ page, baseURL }) => {
    test.skip(await signedIn(page, baseURL, "community"), "Onboarding is on here; the tests below cover it.");
    for (const partner of PARTNERS) {
      expect(await location(page, welcome(partner.intent))).toBe(partner.legacy);
      await page.goto(partner.page);
      const ctas = partnerCtas(page);
      for (const cta of await ctas.all()) await expect(cta).toHaveAttribute("href", welcome(partner.intent));
      await expect(page.locator("[data-community-root]")).toHaveAttribute("data-access-flow", "legacy");
      const [response] = await Promise.all([page.waitForResponse(r => new URL(r.url()).pathname === partner.legacy), ctas.first().click()]);
      expect(response.status()).toBe(200);
      await expect(page).toHaveURL(new URL(partner.legacy, baseURL!).href);
    }
  });

  test("with onboarding on, each CTA opens the welcome step with its card chosen and nothing sent", async ({ page, baseURL }) => {
    test.skip(PREVIEW, "Preview personas are delegated agent sessions, which the welcome step refuses.");
    test.skip(!(await signedIn(page, baseURL, "community")), "Onboarding is off here; the test above covers it.");
    test.skip(test.info().project.name !== "chromium", "The persona is shared between projects.");
    const requests = async () => ((await (await page.request.get("/api/platform/onboarding")).json()) as { requests: unknown[] }).requests;
    const before = await requests();
    for (const partner of PARTNERS) {
      await page.goto(partner.page);
      await expect(page.locator("[data-community-root]")).toHaveAttribute("data-access-flow", "request");
      await partnerCtas(page).first().click();
      await expect(page).toHaveURL(new URL(welcome(partner.intent), baseURL!).href);
      await expect(main(page).getByRole("heading", { level: 1 })).toHaveText("How will you take part?");
      await expect(main(page).getByRole("checkbox", { name: partner.card, exact: true })).toBeChecked();
      await page.screenshot({ path: `${EVIDENCE_DIR}/welcome-${partner.intent}-preselected.png`, animations: "disabled" });
    }
    // A hint only chooses a card: it never sends a request.
    expect(await requests()).toEqual(before);
  });

  for (const partner of PARTNERS) {
    test(`with onboarding on, someone who already holds ${partner.intent} access goes to ${partner.space}`, async ({ page, baseURL }) => {
      test.skip(PREVIEW && partner.holder === "mentor", "Agent previews have no mentor persona; the local seed covers it.");
      test.skip(!(await signedIn(page, baseURL, partner.holder)), "Onboarding is off here.");
      expect(await location(page, welcome(partner.intent))).toBe(partner.space);
    });
  }
});
