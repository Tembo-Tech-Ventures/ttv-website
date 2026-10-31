import { expect, test, type APIRequestContext } from "@playwright/test";
import { FIXTURE_ENVIRONMENT } from "./fixture-env";
import { signIn } from "./platform-personas";
import { deriveAgentPreviewAuthSecret } from "../scripts/cloudflare/agent-preview-auth.mjs";
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
      // Admin keeps its own middleware, which sends a signed-in non-admin home.
      const admin = await spaceRouteRequest(request, baseURL!, "/admin");
      expect(admin.status(), "/admin").toBe(302);
      expect(new URL(admin.headers().location!, baseURL).pathname, "/admin").toBe("/dashboard");
    });
  });
}

test.describe("preview mentor persona in a browser", () => {
  const token = process.env.PLAYWRIGHT_MENTOR_TOKEN;
  const previewSecret = process.env.AGENT_PREVIEW_SECRET?.trim();
  test.skip(!FIXTURE_ENVIRONMENT || !token || !previewSecret, "Role personas exist only on isolated agent previews.");

  // Known gap, kept visible: the preview persona session carries the delegated
  // ttv-agent: marker, and the mentor review API refuses delegated sessions
  // (requireBrowser in lib/community/http.ts). So the seeded mentor reaches
  // the mentoring space but cannot load the review it offers. Admitting this
  // one synthetic session is an auth decision for a follow-up; when it lands,
  // this expectation becomes 200 and the mentor joins PREVIEW_TOKENS.
  test("signs in, and is refused mentor review as a delegated session", async ({ browser, baseURL }) => {
    const context = await browser.newContext({ baseURL });
    try {
      const environmentName = process.env.EXPECTED_DEPLOYMENT_ENVIRONMENT!;
      await signIn(context, baseURL!, { key: "mentor", token: token!, secret: deriveAgentPreviewAuthSecret(previewSecret!, environmentName) });
      // The cookie session itself is valid, so the refusal below is not an auth failure.
      expect((await context.request.get("/api/platform/me", { maxRedirects: 0 })).status()).toBe(200);
      const review = await context.request.get("/api/community/mentorship", { maxRedirects: 0 });
      expect(review.status()).toBe(403);
      expect(await review.json()).toEqual({ error: "Use a browser session to manage access or review mentorship." });
    } finally {
      await context.close();
    }
  });
});
