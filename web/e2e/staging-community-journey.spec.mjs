// LOCAL MOCK CONTRACT TEST of the verifier itself. Never live staging evidence.
import { URL } from "node:url";
import { test, expect } from "@playwright/test";
import { rm, readFile } from "node:fs/promises";
import { verifyStagingCommunityJourney, COMMUNITY_EVIDENCE_DIRECTORY } from "../scripts/cloudflare/staging-community-journey.mjs";

test("synthetic verifier exercises persisted browser transitions at desktop and mobile (mock server)", async ({ browser, request }, testInfo) => {
  test.skip(testInfo.project.name !== "desktop", "Verifier explicitly runs both viewports.");
  test.setTimeout(90000);
  const run = "aaaaaaaaaaaaaaaaaaaaaaaa";
  const users = Object.fromEntries(["member", "mentor", "institution"].map(role => [role, { userId: `ttv-staging-fixture-${run}-${role}` }]));
  const names = { member: "Fictional Amina Wanjiku", mentor: "Fictional Grace Njeri", institution: "Fictional David Mwangi" };
  const profiles = Object.fromEntries(Object.keys(users).map(role => [role, { ...users[role], name: names[role], image: null, headline: "", bio: "", skills: [], opportunityGoals: "", version: 1, updatedAt: 123 }]));
  const entries = [];
  const calls = [];
  const pageErrors = [];
  function api(role, path, method = "GET", body) {
    calls.push({ role, path, method });
    const url = new URL(path, "https://staging.tembotechventures.com");
    if (url.pathname.endsWith("/access")) return { isAdmin: false, isMentor: role === "mentor", isInstitution: role === "institution" };
    if (url.pathname.endsWith("/profile")) {
      if (method === "PUT") Object.assign(profiles[role], body, { version: profiles[role].version + 1 });
      return { profile: profiles[role] };
    }
    if (url.pathname.endsWith("/confirmations")) {
      const entry = entries.find(e => url.pathname.includes(`/${e.id}/`));
      expect(body.expectedRevision).toBe(entry.version);
      const confirmation = { id: `c-${entry.id}`, journeyId: entry.id, mentorId: users.mentor.userId, mentorName: names.mentor, mentorRole: "MENTOR", journeyVersion: entry.version, statement: body.statement, method: body.method, createdAt: 1792800000 };
      entry.confirmations.push(confirmation);
      return { confirmation };
    }
    if (url.pathname.endsWith("/journey")) {
      if (method === "POST") {
        const entry = { ...body, id: `entry-${entries.length}`, userId: users.member.userId, version: 1, confirmations: [] };
        entries.push(entry); return { entry };
      }
      return { entries };
    }
    if (url.pathname.endsWith("/mentorship")) return { entries: entries.map(e => ({ ...e, memberName: names.member })) };
    if (url.pathname.endsWith("/profiles")) return { profiles: url.searchParams.get("skills") === "NonexistentSyntheticSkill" ? [] : [profiles.member] };
    if (url.pathname.endsWith(`/${users.member.userId}`)) return { profile: profiles.member, entries };
    throw new Error("Unexpected mock route");
  }
  const realContexts = [];
  const contextsByRole = {};
  try {
    for (const role of Object.keys(users)) {
      const context = await browser.newContext(); realContexts.push(context);
      await context.route("**/*", async route => {
        const url = new URL(route.request().url());
        if (url.origin !== "https://staging.tembotechventures.com") return route.abort();
        if (url.pathname.startsWith("/api/community/")) return route.fulfill({ json: api(role, url.href, route.request().method(), route.request().postDataJSON()) });
        if (url.pathname.startsWith("/dashboard/")) {
          return route.fulfill({ contentType: "text/html", body: '<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head><body><p>LOCAL MOCK verifier test — not staging evidence</p><div id="root"></div><script type="module" src="/staging-journey.tsx"></script></body></html>' });
        }
        const response = await request.get(`http://127.0.0.1:4322${url.pathname}${url.search}`);
        return route.fulfill({ response });
      });
      contextsByRole[role] = { newPage: async () => { const page = await context.newPage(); page.on("pageerror", error => pageErrors.push(error.message)); return page; }, request: { get: async path => ({ status: () => 200, json: async () => JSON.parse(JSON.stringify(api(role, path))) }) } };
    }
    await verifyStagingCommunityJourney({ baseUrl: "https://staging.tembotechventures.com", contextsByRole, users });
    expect(entries).toHaveLength(2);
    expect(calls.filter(call => call.method === "PUT")).toHaveLength(2);
    expect(calls.filter(call => call.method === "POST" && call.path.endsWith("/journey"))).toHaveLength(2);
    expect(calls.filter(call => call.method === "POST" && call.path.endsWith("/confirmations"))).toHaveLength(2);
    const searchCalls = calls.filter(call => new URL(call.path, "https://staging.tembotechventures.com").pathname.endsWith("/profiles"));
    expect(searchCalls).toHaveLength(6);
    expect(searchCalls.filter(call => new URL(call.path).searchParams.get("skills") === "" && new URL(call.path).searchParams.get("query") === names.member)).toHaveLength(2);
    expect(entries.every(e => e.confirmations.length === 1)).toBe(true);
    expect(calls.some(c => c.path.includes("/chat"))).toBe(false);
    expect(JSON.parse(await readFile(`${COMMUNITY_EVIDENCE_DIRECTORY}/manifest.json`, "utf8"))).toMatchObject({ status: "passed", completedViewports: ["desktop", "mobile"] });
  } catch {
    throw new Error("Local mock verifier failed: " + await readFile(`${COMMUNITY_EVIDENCE_DIRECTORY}/manifest.json`, "utf8") + JSON.stringify({ calls, pageErrors }));
  } finally {
    await Promise.all(realContexts.map(context => context.close()));
    // Mock screenshots must never be confused with uploadable live evidence.
    await rm(COMMUNITY_EVIDENCE_DIRECTORY, { recursive: true, force: true });
  }
});
