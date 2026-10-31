import { expect, test, type Page } from "@playwright/test";
import { mkdirSync } from "node:fs";
import { FIXTURE_ENVIRONMENT } from "./fixture-env";
import { spaceRouteRequest } from "../scripts/cloudflare/space-route-browser-guard.mjs";

const EVIDENCE_DIR = "test-results/evidence";
mkdirSync(EVIDENCE_DIR, { recursive: true });

const evidence = (persona: string) =>
  `${EVIDENCE_DIR}/${test.info().project.name}-student-${persona}.png`;

const personas = [
  {
    name: "new-sign-in",
    token: process.env.PLAYWRIGHT_NEW_STUDENT_TOKEN,
    cohortMember: false,
    nextStep: /Apply to Open Cohort/,
    actionName: "Apply",
    actionHref: "/dashboard/apply",
    activePath: "/dashboard/apply",
    activeLabel: "Apply",
    links: [
      "/dashboard",
      "/dashboard/community",
      "/dashboard/apply",
      "/dashboard/ask",
      "/dashboard/profile",
      "/auth/logout",
    ],
  },
  {
    name: "accepted",
    token: process.env.PLAYWRIGHT_ACCEPTED_STUDENT_TOKEN,
    cohortMember: true,
    nextStep: "Start with your cohort sessions",
    actionName: "Watch sessions",
    actionHref: "/dashboard/sessions",
    activePath: "/dashboard/sessions",
    activeLabel: "Sessions",
    links: [
      "/dashboard",
      "/dashboard/community",
      "/dashboard/apply",
      "/dashboard/sessions",
      "/dashboard/ask",
      "/dashboard/profile",
      "/auth/logout",
    ],
  },
  {
    name: "graduate",
    token: process.env.PLAYWRIGHT_GRADUATE_STUDENT_TOKEN,
    cohortMember: true,
    nextStep: "Your certificate is ready",
    actionName: "View certificate",
    actionHref: "/certificate/ttv-fixture-app-journey-graduate",
    activePath: "/dashboard/sessions",
    activeLabel: "Sessions",
    links: [
      "/dashboard",
      "/dashboard/community",
      "/dashboard/apply",
      "/dashboard/sessions",
      "/dashboard/ask",
      "/dashboard/portfolio",
      "/dashboard/profile",
      "/auth/logout",
    ],
  },
] as const;

async function openMobileNavigation(page: Page, isMobile: boolean) {
  if (!isMobile) return;
  const opener = page.getByRole("button", { name: "Open navigation" });
  await expect(opener).toBeEnabled();
  await opener.click();
  await expect(opener).toHaveAttribute("aria-expanded", "true");
}

function visibleSiteNavigation(page: Page) {
  return page.locator("nav:visible").filter({
    has: page.getByRole("link", { name: "Home", exact: true }),
  });
}

/** The persona's spaces, or null while the spaces flag is OFF. */
async function personaSpaces(page: Page, baseURL: string): Promise<string[] | null> {
  const response = await spaceRouteRequest(page.request, baseURL, "/api/platform/me");
  if (response.status() === 404) return null;
  expect(response.status()).toBe(200);
  return ((await response.json()) as { spaces: string[] }).spaces;
}

for (const persona of personas) {
  test.describe(`student dashboard: ${persona.name}`, () => {
    test.skip(
      !FIXTURE_ENVIRONMENT || !persona.token,
      "Requires seeded student personas in an isolated agent preview."
    );
    test.use({
      extraHTTPHeaders: persona.token
        ? { Authorization: `Bearer ${persona.token}` }
        : {},
    });

    test("shows the applicable links, one next step and stable active state", async ({
      page,
      viewport,
      baseURL,
    }) => {
      const hydrationMessages: string[] = [];
      const recordHydrationProblem = (message: string) => {
        if (/hydration|did not match/i.test(message)) {
          hydrationMessages.push(message);
        }
      };
      page.on("console", (message) => recordHydrationProblem(message.text()));
      page.on("pageerror", (error) => recordHydrationProblem(error.message));

      const isMobile = (viewport?.width ?? 1280) < 1024;
      const spaces = await personaSpaces(page, baseURL!);
      if (spaces) expect(spaces.includes("cohort")).toBe(persona.cohortMember);
      if (spaces && !persona.cohortMember) {
        // Spaces ON: without a cohort, /dashboard opens the community space.
        // Its workspace is not asserted here: the community API refuses
        // bearer-header sessions (lib/community/http.ts), which this harness
        // uses. Cookie sessions in a real browser are unaffected.
        const landing = await page.goto("/dashboard");
        expect(landing?.request().redirectedFrom()?.url()).toBe(new URL("/dashboard", baseURL).href);
        await expect(page).toHaveURL(/\/dashboard\/community$/);

        // The next step still works: the existing Apply link reaches a usable form.
        const apply = await page.goto(persona.actionHref);
        expect(apply?.status()).toBe(200);
        await expect(page).toHaveURL(/\/dashboard\/cohort\/apply$/);
        await expect(page.getByRole("heading", { name: "Apply to a Cohort" })).toBeVisible();
        await expect(
          page.locator("[data-cohort-id]").getByRole("button", { name: "Apply", exact: true }).first()
        ).toBeEnabled();
        await openMobileNavigation(page, isMobile);
        const applyLink = visibleSiteNavigation(page).getByRole("link", {
          name: persona.activeLabel,
          exact: true,
        });
        await expect(applyLink).toHaveAttribute("aria-current", "page");
        await page.screenshot({ path: evidence(persona.name), fullPage: true });
        expect(hydrationMessages).toEqual([]);
        return;
      }

      const response = await page.goto("/dashboard");
      expect(response?.status()).toBe(200);
      await page.waitForLoadState("networkidle");

      const nextStepCard = page.getByRole("region", { name: persona.nextStep });
      const nextStep = nextStepCard.getByTestId("student-next-step");
      await expect(nextStep).toHaveText(persona.nextStep);
      await expect(
        nextStepCard.getByRole("link", {
          name: persona.actionName,
          exact: true,
        })
      ).toHaveAttribute("href", persona.actionHref);
      await expect(page.getByText("Your next step", { exact: true })).toHaveCount(1);

      await openMobileNavigation(page, isMobile);
      const navigation = visibleSiteNavigation(page);
      await expect(navigation).toBeVisible();
      expect(
        await navigation.locator("a").evaluateAll((links) =>
          links.map((link) => link.getAttribute("href"))
        )
      ).toEqual(persona.links);

      const home = navigation.getByRole("link", { name: "Home", exact: true });
      await expect(home).toHaveAttribute("aria-current", "page");
      await expect(home).toHaveClass(/bg-primary\/20/);

      await page.screenshot({ path: evidence(persona.name), fullPage: true });

      const activeResponse = await page.goto(persona.activePath);
      expect(activeResponse?.status()).toBe(200);
      await page.waitForLoadState("networkidle");
      await openMobileNavigation(page, isMobile);
      const activeLink = visibleSiteNavigation(page).getByRole("link", {
        name: persona.activeLabel,
        exact: true,
      });
      await expect(activeLink).toHaveAttribute("aria-current", "page");
      await expect(activeLink).toHaveClass(/bg-primary\/20/);

      expect(hydrationMessages).toEqual([]);
    });
  });
}
