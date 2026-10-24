import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { assertJourneyScope } from "./staging-community-journey.mjs";

const routes = ["members", "mentors", "institutions"];
export function audienceRoutesPresent(exists = existsSync) {
  const present = routes.map(name => exists(new URL(`../../src/pages/community/${name}.astro`, import.meta.url)));
  if (present.some(Boolean) && !present.every(Boolean)) throw new Error("Audience routes must be integrated together.");
  return present.every(Boolean);
}
const journeys = [
  { audience: "members", role: "member", cta: "Open my community journey", anonymous: "Build your community profile", destination: "/dashboard/community", heading: "Your work. Your story." },
  { audience: "mentors", role: "mentor", cta: "Continue to mentor review", destination: "/dashboard/mentorship", heading: "Recognise the work. Name what you saw.", gate: "Mentor access needs approval." },
  { audience: "institutions", role: "institution", cta: "Continue to institutional access", destination: "/dashboard/discover", heading: "Find the person. See the work.", gate: "Institutional access needs approval." },
];

/** Fixed same-origin browser navigation only; no model endpoints or credentials. */
export async function verifyAudienceAccess({ baseUrl, contextsByRole, users, anonymousContext }) {
  assertJourneyScope({ baseUrl, contextsByRole, users });
  const pages = [];
  let failure;
  try {
    for (const viewport of [{ width: 1440, height: 1000 }, { width: 390, height: 844 }]) {
      for (const journey of journeys) {
        for (const mode of ["anonymous", "eligible", ...(journey.gate ? ["missing-role"] : [])]) {
          const context = mode === "anonymous" ? anonymousContext : contextsByRole[mode === "missing-role" ? "member" : journey.role];
          const page = await context.newPage(); pages.push(page);
          await page.setViewportSize(viewport);
          const response = await page.goto(`${baseUrl}/community/${journey.audience}`, { waitUntil: "networkidle", timeout: 30000 });
          assert.equal(response?.status(), 200);
          const link = page.getByRole("link", { name: mode === "anonymous" ? journey.anonymous ?? journey.cta : journey.cta, exact: true }).first();
          const destination = mode === "anonymous" ? `/auth/login?next=${encodeURIComponent(journey.destination)}` : journey.destination;
          assert.equal(await link.getAttribute("href"), destination);
          await link.click();
          await page.waitForURL(`${baseUrl}${destination}`, { timeout: 30000 });
          const heading = mode === "anonymous" ? page.getByRole("heading", { level: 1 }) : page.locator(".discovery-app").getByRole("heading", { level: 1 });
          await heading.waitFor({ state: "visible", timeout: 30000 });
          assert.equal((await heading.textContent())?.trim(), mode === "anonymous" ? "Sign in to Tembo." : mode === "missing-role" ? journey.gate : journey.heading);
          if (mode === "missing-role") assert.equal(await page.getByRole("link", { name: "Go to your journey", exact: true }).getAttribute("href"), "/dashboard/community");
        }
      }
    }
  } catch {
    failure = new Error("Synthetic audience access verification failed.");
  } finally {
    const results = await Promise.allSettled(pages.map(page => page.close()));
    if (results.some(result => result.status === "rejected")) failure = new Error("Synthetic audience page cleanup failed.");
  }
  if (failure) throw failure;
}
