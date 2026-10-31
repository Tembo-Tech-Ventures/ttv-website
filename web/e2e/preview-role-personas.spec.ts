import { expect, test, type APIRequestContext } from "@playwright/test";
import { FIXTURE_ENVIRONMENT } from "./fixture-env";
import { spaceRouteRequest } from "../scripts/cloudflare/space-route-browser-guard.mjs";

/**
 * The seeded preview mentor and institution, checked at the route and API
 * level: each reaches its own space and nothing a global role must not grant.
 * Their sessions exist only on isolated agent previews (run-live-e2e.mjs).
 */
const personas = [
  {
    name: "mentor",
    token: process.env.PLAYWRIGHT_MENTOR_TOKEN,
    spaces: ["community", "mentoring", "profile"],
    capabilities: { isMentor: true, isInstitution: false, isAdmin: false },
    reachable: ["/dashboard/mentoring", "/dashboard/community", "/dashboard/me"],
    denied: ["/dashboard/cohort", "/dashboard/cohort/sessions", "/dashboard/discover"],
  },
  {
    name: "institution",
    token: process.env.PLAYWRIGHT_INSTITUTION_TOKEN,
    spaces: ["community", "discover", "profile"],
    capabilities: { isMentor: false, isInstitution: true, isAdmin: false },
    reachable: ["/dashboard/discover", "/dashboard/community", "/dashboard/me"],
    // Approval widens nothing cohort-private: no cohort, its recordings or Ask.
    denied: [
      "/dashboard/cohort",
      "/dashboard/cohort/sessions",
      "/dashboard/cohort/sessions/ttv-fixture-recording-failed",
      "/dashboard/sessions/ttv-fixture-recording-failed",
      "/dashboard/mentoring",
    ],
  },
] as const;

async function status(request: APIRequestContext, baseURL: string, path: string) {
  return (await spaceRouteRequest(request, baseURL, path)).status();
}

for (const persona of personas) {
  test.describe(`preview ${persona.name} persona`, () => {
    test.skip(!FIXTURE_ENVIRONMENT || !persona.token, "Role personas exist only on isolated agent previews.");
    test.use({ extraHTTPHeaders: persona.token ? { Authorization: `Bearer ${persona.token}` } : {} });

    test("holds exactly its global role and no cohort scope", async ({ request, baseURL }) => {
      const response = await spaceRouteRequest(request, baseURL!, "/api/platform/me");
      expect(response.status()).toBe(200);
      const me = await response.json() as {
        spaces: string[];
        capabilities: { cohortIds: string[]; mentorCohortIds: string[]; isMentor: boolean; isInstitution: boolean; isAdmin: boolean };
      };
      expect(me.spaces).toEqual(persona.spaces);
      expect(me.capabilities).toMatchObject({ ...persona.capabilities, cohortIds: [], mentorCohortIds: [] });
    });

    test("reaches its spaces and is refused the rest", async ({ request, baseURL }) => {
      for (const path of persona.reachable) {
        expect(await status(request, baseURL!, path), path).toBe(200);
      }
      for (const path of persona.denied) {
        expect(await status(request, baseURL!, path), path).toBe(403);
      }
      // Admin keeps its own middleware: no admin page, whatever the response.
      expect(await status(request, baseURL!, "/admin"), "/admin").not.toBe(200);
    });
  });
}
